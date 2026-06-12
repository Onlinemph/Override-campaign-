/**
 * core/truth.ts — campaign lifecycle: genesis, replay, the run loop with compression.
 */
import type {
  BattleResult, GroundPos, HandoffPackage, Id, Order, TruthState,
} from './types.js';
import { applyEvent, type GameEvent, type LoggedEvent } from './events.js';
import type { EventStore } from './log.js';
import { MemoryEventStore } from './log.js';
import { step } from '../engine/tick.js';
import { isFormationOnNet, netPass, scoutPass } from '../engine/net.js';
import { buildHandoff } from '../handoff/export.js';
import { ingestBattleResult } from '../handoff/import.js';
import { rollDice } from './rng.js';
import { CLOCK, ENGAGEMENT, LADDER, SKYWATCH, SUPPLY } from '../rules.js';

/** Rebuild truth purely from the log: truth = fold(applyEvent, genesis, events). */
export function replay(events: LoggedEvent[]): TruthState {
  const genesis = events[0];
  if (!genesis || genesis.event.type !== 'CAMPAIGN_INIT') {
    throw new Error('log must begin with CAMPAIGN_INIT');
  }
  const truth = structuredClone(genesis.event.state);
  for (const { event } of events.slice(1)) applyEvent(truth, event);
  return truth;
}

export class Campaign {
  truth: TruthState;
  constructor(public store: EventStore, truth?: TruthState) {
    this.truth = truth ?? replay(store.all());
  }

  static create(initial: TruthState, store: EventStore = new MemoryEventStore()): Campaign {
    if (store.length() > 0) throw new Error('store is not empty');
    store.append({ type: 'CAMPAIGN_INIT', state: structuredClone(initial) });
    const campaign = new Campaign(store, structuredClone(initial));
    // initialize nets & scouted terrain at tick 0, through the log like everything else
    const init: GameEvent[] = [];
    const emit = (e: GameEvent) => { init.push(e); applyEvent(campaign.truth, e); };
    netPass(campaign.truth, emit);
    scoutPass(campaign.truth, emit);
    for (const e of init) store.append(e);
    return campaign;
  }

  static fromStore(store: EventStore): Campaign {
    return new Campaign(store);
  }

  /** One engine step. Returns the emitted events. */
  step(): GameEvent[] {
    const r = step(this.truth);
    for (const e of r.events) this.store.append(e);
    this.truth = r.truth;
    return r.events;
  }

  /** Compression loop: run until something happens for someone, or the tick cap. */
  runUntilEvent(maxTicks = CLOCK.TICKS_PER_DAY): GameEvent[] {
    const startTick = this.truth.tick;
    const collected: GameEvent[] = [];
    while (this.truth.tick - startTick < maxTicks) {
      const r = step(this.truth);
      for (const e of r.events) this.store.append(e);
      this.truth = r.truth;
      collected.push(...r.events);
      if (r.interesting || r.paused) break; // freeze on a pending engagement
    }
    return collected;
  }

  get pendingEngagement() {
    return this.truth.pendingEngagementId
      ? this.truth.engagements[this.truth.pendingEngagementId] : null;
  }

  /**
   * Order entry. On-net formations get the order effective next tick; off-net
   * formations cannot be reached at all (spec §3.3) — conditionals/standing orders
   * are the only way to influence them. Genesis orders bypass this (pre-plotted ops).
   */
  issueOrder(order: Order): { ok: true } | { ok: false; reason: string } {
    const f = this.truth.formations[order.formationId];
    if (!f || f.destroyed) return { ok: false, reason: 'no such formation' };
    if (f.routUntilTick != null && this.truth.tick < f.routUntilTick) {
      return { ok: false, reason: 'formation is routed and uncommandable (core 3.2/7.4)' };
    }
    if (!isFormationOnNet(this.truth, f)) {
      return { ok: false, reason: 'formation is off-net: order undeliverable (core 4.2)' };
    }
    const stamped: Order = { ...order, issuedTick: this.truth.tick,
                             effectiveTick: this.truth.tick + 1 };
    const e: GameEvent = { type: 'ORDER_ISSUED', order: stamped };
    this.store.append(e);
    applyEvent(this.truth, e);
    return { ok: true };
  }

  /** GM controls. */
  inject(e: GameEvent): void {
    this.store.append(e);
    applyEvent(this.truth, e);
  }

  destroyFormation(formationId: Id, reason: string): void {
    this.inject({ type: 'FORMATION_DESTROYED', formationId, reason, tick: this.truth.tick });
  }

  // ── M2: engagement resolution (GM-driven) ─────────────────────────────────

  /**
   * Defender's evasion attempt before setup (core §7.1): opposed 2d6 + OMP, +2 to the
   * defender if the attacker only holds GHOST/SHADOW. Win by 3+ ⇒ slip 2 hexes (GM picks
   * the destination) and the slipping side is auto-detected at CONTACT. Failure leaves
   * the engagement pending for handoff export.
   */
  resolveEvasion(slipTo?: GroundPos): { success: boolean; reason?: string } {
    const eng = this.pendingEngagement;
    if (!eng || eng.status !== 'PENDING') return { success: false, reason: 'no pending engagement' };
    if (eng.domain === 'AIR') {
      return { success: false, reason: 'air merges have no evasion roll — escape happens in the chase (SKYWATCH §6)' };
    }

    const defOmp = Math.max(0, ...eng.defenderFormationIds.map(id => this.truth.formations[id]?.omp ?? 0));
    const atkOmp = Math.max(0, ...eng.attackerFormationIds.map(id => this.truth.formations[id]?.omp ?? 0));

    // attacker's best ladder on the defenders
    let atkLadder = 0;
    for (const c of Object.values(this.truth.contacts)) {
      if (c.observerSideId === eng.attackerSideId && eng.defenderFormationIds.includes(c.targetFormationId)) {
        atkLadder = Math.max(atkLadder, c.level);
      }
    }
    const blindBonus = atkLadder <= 2 ? ENGAGEMENT.EVASION_GHOST_SHADOW_BONUS : 0;

    const defRoll = this.rollLogged('2d6', 'evasion: defender');
    const atkRoll = this.rollLogged('2d6', 'evasion: attacker');
    const defTotal = defRoll + defOmp + blindBonus;
    const atkTotal = atkRoll + atkOmp;
    const success = defTotal - atkTotal >= ENGAGEMENT.EVASION_WIN_MARGIN;

    let dest: GroundPos | null = null;
    if (success) {
      dest = slipTo ?? this.defaultSlip(eng);
      // the defender slips (move) and is auto-detected at CONTACT (core §7.1)
      for (const fid of eng.defenderFormationIds) {
        const f = this.truth.formations[fid];
        if (f && !f.destroyed && f.pos.kind === 'ground' && dest) {
          this.inject({ type: 'FORMATION_MOVED', formationId: fid, to: dest,
                        movedKind: 'NORMAL', onRoad: false, headingDeg: 0, tick: this.truth.tick });
        }
        this.inject({ type: 'CONTACT_UPGRADED',
          contact: this.contactAt(eng.attackerSideId, fid, LADDER.MAX_LEVEL - 1), tick: this.truth.tick });
      }
    }
    this.inject({ type: 'EVASION_RESOLVED', engagementId: eng.id, success, slipTo: dest,
                  tick: this.truth.tick });
    return { success };
  }

  /** Export the handoff package for the pending engagement (does not unfreeze). */
  exportHandoff(): HandoffPackage | null {
    const eng = this.pendingEngagement;
    if (!eng || (eng.status !== 'PENDING' && eng.status !== 'EXPORTED')) return null;
    const pkg = buildHandoff(this.truth, eng);
    this.inject({ type: 'HANDOFF_EXPORTED', engagementId: eng.id, pkg, tick: this.truth.tick });
    return pkg;
  }

  /** Ingest a BattleResult, applying all outcomes and unfreezing the campaign. */
  ingestBattleResult(result: BattleResult): { ok: boolean; reason?: string } {
    const eng = Object.values(this.truth.engagements).find(e => e.handoffId === result.handoffId)
      ?? this.pendingEngagement;
    if (!eng) return { ok: false, reason: 'no engagement for this handoff' };
    for (const e of ingestBattleResult(this.truth, eng, result)) this.inject(e);
    return { ok: true };
  }

  // ── M3: SKYWATCH GM/player actions ─────────────────────────────────────────

  /** Set a grounded flight's alert state (SKYWATCH §3.1 — set per flight, per pulse). */
  setAlertState(formationId: Id, state: NonNullable<import('./types.js').Formation['alertState']>):
      { ok: boolean; reason?: string } {
    const f = this.truth.formations[formationId];
    if (!f || f.destroyed) return { ok: false, reason: 'no such formation' };
    if (f.pos.kind !== 'ground') return { ok: false, reason: 'flight is airborne' };
    this.inject({ type: 'ALERT_CHANGED', formationId, alertState: state, tick: this.truth.tick });
    return { ok: true };
  }

  /**
   * Turnaround at the flight's facility (SKYWATCH §3): STANDARD = rearm + refuel in
   * 2 pulses; HOT_PIT = 1 pulse with a 2d6 mishap chance on 2–3 (1d6×10 FP of farm
   * stock burns and the flight stands down a pulse).
   */
  turnaround(formationId: Id, mode: 'STANDARD' | 'HOT_PIT'):
      { ok: true; readyTick: number; tonsDrawn: number; mishap: boolean }
      | { ok: false; reason: string } {
    const f = this.truth.formations[formationId];
    if (!f || f.destroyed || f.pos.kind !== 'ground') {
      return { ok: false, reason: 'flight is not on the ground' };
    }
    const fac = Object.values(this.truth.facilities).find(x =>
      x.sideId === f.sideId && x.pos.kind === 'ground' && f.pos.kind === 'ground' &&
      x.pos.theaterId === f.pos.theaterId && x.pos.q === f.pos.q && x.pos.r === f.pos.r);
    if (!fac) return { ok: false, reason: 'no friendly facility in this hex' };
    const busy = fac.turnaroundCrews.busyUntil.filter(t => t > this.truth.tick).length;
    if (busy >= fac.turnaroundCrews.total) return { ok: false, reason: 'all turnaround crews busy' };
    if (f.unitIds.length > SKYWATCH.CREW_FLIGHT_MAX_AIRCRAFT) {
      return { ok: false, reason: `a crew handles at most ${SKYWATCH.CREW_FLIGHT_MAX_AIRCRAFT} aircraft` };
    }

    const fpNeeded = f.unitIds.reduce((sum, uid) => {
      const fuel = this.truth.units[uid]?.fuel;
      return fuel ? sum + Math.max(0, fuel.tons * fuel.fpPerTon - fuel.fp) : sum;
    }, 0);
    const tonsDrawn = fpNeeded / SKYWATCH.FP_PER_TON;
    if (tonsDrawn > fac.fuelFarmTons + 1e-9) {
      return { ok: false, reason: `fuel farm holds ${fac.fuelFarmTons.toFixed(2)} t, need ${tonsDrawn.toFixed(2)} t` };
    }

    let mishap = false;
    let mishapFarmFpLoss: number | undefined;
    let pulses = mode === 'HOT_PIT' ? SKYWATCH.HOT_PIT_PULSES : SKYWATCH.TURNAROUND_PULSES;
    if (mode === 'HOT_PIT') {
      const roll = this.rollLogged('2d6', `hot-pit turnaround ${formationId}`);
      if (roll <= SKYWATCH.HOT_PIT_MISHAP_MAX) {
        mishap = true;
        const d6 = this.rollLogged('1d6', `hot-pit mishap ${formationId}`);
        mishapFarmFpLoss = d6 * SKYWATCH.HOT_PIT_MISHAP_FARM_FP_PER_D6;
        pulses += SKYWATCH.HOT_PIT_MISHAP_STAND_DOWN_PULSES;
      }
    }
    const readyTick = this.truth.tick + pulses * CLOCK.TICKS_PER_PULSE;
    this.inject({ type: 'TURNAROUND_STARTED', formationId, facilityId: fac.id, mode,
                  readyTick, tonsDrawn, mishapFarmFpLoss, tick: this.truth.tick });
    return { ok: true, readyTick, tonsDrawn, mishap };
  }

  /** GM: spawn an arriving formation (reinforcements, raiders, drop arrivals). */
  spawnFormation(formation: import('./types.js').Formation,
                 units: import('./types.js').Unit[],
                 pilots: import('./types.js').Pilot[] = []): void {
    this.inject({ type: 'FORMATION_SPAWNED', formation, units, pilots, tick: this.truth.tick });
  }

  /**
   * GM: place a flight where the tabletop left it (SKYWATCH §8.1 — flights return to
   * the grid at their exit position and vector; the table knows, the tool records).
   */
  repositionAir(formationId: Id, gridQ: number, gridR: number, vectorDeg = 0):
      { ok: boolean; reason?: string } {
    const f = this.truth.formations[formationId];
    if (!f || f.pos.kind !== 'air') return { ok: false, reason: 'formation is not airborne' };
    this.inject({ type: 'AIR_MOVED', formationId,
                  pos: { ...f.pos, gridQ, gridR, vectorDeg }, fpPaid: 0,
                  speed: f.air?.speed ?? 'CRUISE', tick: this.truth.tick });
    return { ok: true };
  }

  /** Resolve one hauled salvage token at a depot: 2d6 ≥8 ⇒ unit, else parts (core §10.4). */
  resolveSalvage(tokenId: Id): { outcome: 'UNIT' | 'PARTS' } | { error: string } {
    const token = this.truth.salvage[tokenId];
    if (!token) return { error: 'no such salvage token' };
    const roll = this.rollLogged('2d6', `salvage recovery ${tokenId}`);
    const outcome = roll >= SUPPLY.SALVAGE_RECOVER_TN ? 'UNIT' : 'PARTS';
    this.inject({ type: 'SALVAGE_RESOLVED', tokenId, outcome, tick: this.truth.tick });
    return { outcome };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private rollLogged(dice: '2d6' | '1d6', purpose: string): number {
    const r = rollDice(this.truth.seed, this.truth.seedCursor, dice);
    this.inject({ type: 'DIE_ROLLED', roll: { id: `roll:${this.truth.seedCursor}`,
      tick: this.truth.tick, purpose, dice, result: r.result, seedCursor: r.nextCursor - (dice === '2d6' ? 2 : 1) } });
    return r.result;
  }

  private defaultSlip(eng: { hex?: GroundPos; defenderFormationIds: Id[] }): GroundPos | null {
    // slip away from the nearest attacker, 2 hexes, staying on the map
    const hex = eng.hex;
    if (!hex) return null;
    const dirs = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
                  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];
    for (const d of dirs) {
      const to: GroundPos = { ...hex, q: hex.q + d.q * ENGAGEMENT.EVASION_SLIP_HEXES,
                              r: hex.r + d.r * ENGAGEMENT.EVASION_SLIP_HEXES };
      if (this.truth.theaters[to.theaterId]?.hexes[`${to.q},${to.r}`]) return to;
    }
    return null;
  }

  private contactAt(observerSideId: Id, targetFormationId: Id, level: number) {
    const f = this.truth.formations[targetFormationId];
    const pos = f.pos as GroundPos;
    return {
      id: `contact:${observerSideId}:${targetFormationId}`, observerSideId, targetFormationId,
      kind: 'STANDARD' as const, level: level as 0 | 1 | 2 | 3 | 4,
      lastConfirmedTick: this.truth.tick, lastFadeTick: this.truth.tick,
      estPos: { ...pos }, posErrorHexes: 0, staleAsOfTick: this.truth.tick,
      delivered: { level: level as 0 | 1 | 2 | 3 | 4, estPos: { ...pos }, posErrorHexes: 0,
                   estVector: f.lastHeadingDeg,
                   estSizeClass: undefined, estComposition: undefined,
                   asOfTick: this.truth.tick },
    };
  }
}
