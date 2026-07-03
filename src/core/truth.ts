/**
 * core/truth.ts — campaign lifecycle: genesis, replay, the run loop with compression.
 */
import type {
  AirPos, BattleResult, Emcon, Engagement, GroundPos, HandoffPackage, Id, Order, TruthState,
} from './types.js';
import {
  airQR, climbFp, isFlight, landingFp, takeoffFp, theaterAirHex,
} from '../engine/air.js';
import { applyEvent, type GameEvent, type LoggedEvent } from './events.js';
import type { EventStore } from './log.js';
import { MemoryEventStore } from './log.js';
import { step } from '../engine/tick.js';
import { isFormationOnNet, netPass, scoutPass } from '../engine/net.js';
import { buildHandoff } from '../handoff/export.js';
import { ingestBattleResult } from '../handoff/import.js';
import { rollDice } from './rng.js';
import { CAREER, CLOCK, DEEPSKY, ENGAGEMENT, LADDER, SKYWATCH, SUPPLY } from '../rules.js';
import { classifyEncounter, emitJumpFlash, type Classification } from '../engine/space.js';
import { flakBatteriesNear, flakGauntlet } from '../engine/flak.js';
import { COMBAT_DROP, FLAK } from '../rules.js';
import { AXIAL_DIRECTIONS, hexDistance } from '../hex/axial.js';

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

  /**
   * Resume a campaign from a non-empty store, or create one from `initial()` into an
   * empty store (M6 persistence). `initial` is a thunk so the fixture is only built when
   * actually starting fresh. Returns the campaign plus whether it resumed.
   */
  static resumeOrCreate(store: EventStore, initial: () => TruthState):
      { campaign: Campaign; resumed: boolean } {
    if (store.length() > 0) {
      return { campaign: Campaign.fromStore(store), resumed: true };
    }
    return { campaign: Campaign.create(initial(), store), resumed: false };
  }

  /** One engine step. `forceMode` overrides the auto clock tier (e.g. 'CONTACT' = 6 min). */
  step(forceMode?: import('../core/types.js').ClockMode): GameEvent[] {
    const r = step(this.truth, forceMode);
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

  /**
   * GM time-travel (D-015): drop every event after the first `eventCount` and rebuild
   * truth from the surviving prefix. The log is otherwise append-only; this is the one
   * sanctioned rewind, used by undo.
   */
  rewind(eventCount: number): void {
    this.store.truncate(eventCount);
    this.truth = replay(this.store.all());
  }

  /**
   * Undo the most recent engine step: rewind to just before the last STEP_BEGAN, so one
   * tick's worth of events comes off. Returns the new tick, or null if there's nothing
   * before the first step (only genesis + tick-0 setup remain).
   */
  rewindOneStep(): { tick: number } | null {
    const all = this.store.all();
    let idx = -1;
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].event.type === 'STEP_BEGAN') { idx = i; break; }
    }
    if (idx <= 0) return null;
    this.rewind(idx);
    return { tick: this.truth.tick };
  }

  /**
   * The truncation point for a rewind to `targetTick`: the index of the first whole
   * step whose clock advance passed the target. Everything from there on — including
   * GM injections (orders, battle results, spawns) entered after that moment — gets
   * dropped. Null when the clock never passed the target (nothing to rewind).
   */
  private rewindCutIndex(targetTick: number): number | null {
    const all = this.store.all();
    let lastStepStart = -1;
    for (let i = 0; i < all.length; i++) {
      const e = all[i].event;
      if (e.type === 'STEP_BEGAN') lastStepStart = i;
      else if (e.type === 'CLOCK_ADVANCED' && e.tick > targetTick) {
        return lastStepStart >= 0 ? lastStepStart : i;
      }
    }
    return null;
  }

  /**
   * GM rewind to a moment (ext, D-035): roll the campaign back to the last state at or
   * before `targetTick` by truncating the log and replaying — the same machinery as
   * undo, aimed. Use previewRewind first to show the GM what history disappears.
   */
  rewindToTick(targetTick: number): { tick: number; dropped: number } | null {
    const cut = this.rewindCutIndex(targetTick);
    if (cut === null) return null;
    const dropped = this.store.length() - cut;
    this.rewind(cut);
    return { tick: this.truth.tick, dropped };
  }

  /**
   * What a rewind to `targetTick` would undo, without doing it: how many events drop,
   * where the clock lands, and the headlines (battles, losses, orders) among them.
   */
  previewRewind(targetTick: number):
      { toTick: number; dropped: number; notable: string[] } | null {
    const cut = this.rewindCutIndex(targetTick);
    if (cut === null) return null;
    const all = this.store.all();
    // where the clock lands: the last completed step before the cut (or genesis)
    let toTick = 0;
    for (let i = cut - 1; i >= 0; i--) {
      const e = all[i].event;
      if (e.type === 'CLOCK_ADVANCED') { toTick = e.tick; break; }
    }
    const name = (id: Id) => this.truth.formations[id]?.name ?? id;
    const notable: string[] = [];
    let orders = 0, reports = 0;
    for (const { event: e } of all.slice(cut)) {
      switch (e.type) {
        case 'ORDER_ISSUED': orders++; break;
        case 'REPORT_DELIVERED': reports++; break;
        case 'ENGAGEMENT_TRIGGERED':
          notable.push(`an engagement (${e.engagement.attackerSideId} vs ${e.engagement.defenderSideId})`);
          break;
        case 'BATTLE_RESULT_INGESTED': notable.push('a battle result'); break;
        case 'FORMATION_DESTROYED': notable.push(`the loss of ${name(e.formationId)}`); break;
        case 'FORMATION_SPAWNED': notable.push(`the arrival of ${e.formation.name}`); break;
        case 'CAMPAIGN_ENDED': notable.push('the campaign ending'); break;
      }
    }
    if (orders) notable.push(`${orders} order${orders === 1 ? '' : 's'}`);
    if (reports) notable.push(`${reports} delivered report${reports === 1 ? '' : 's'}`);
    return { toTick, dropped: all.length - cut, notable };
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
    if (eng.status === 'RESOLVED') return { ok: false, reason: 'engagement already resolved' };
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
                 pilots: import('./types.js').Pilot[] = [],
                 jumpDrives: import('./types.js').JumpDrive[] = []): void {
    this.inject({ type: 'FORMATION_SPAWNED', formation, units, pilots, jumpDrives,
                  tick: this.truth.tick });
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

  // ── M4: DEEP SKY GM/player actions ─────────────────────────────────────────

  /** GM/player: EMCON posture change for a vessel (pickets light their radar here). */
  setEmcon(formationId: Id, emcon: Emcon): { ok: boolean; reason?: string } {
    const f = this.truth.formations[formationId];
    if (!f || f.destroyed) return { ok: false, reason: 'no such formation' };
    this.inject({ type: 'EMCON_CHANGED', formationId, emcon, tick: this.truth.tick });
    return { ok: true };
  }

  /** Deploy the solar sail: charging begins; the vessel cannot thrust (DEEP SKY §7.2). */
  deploySail(unitId: Id): { ok: boolean; reason?: string } {
    const d = this.truth.jumpDrives[unitId];
    if (!d) return { ok: false, reason: 'no jump drive' };
    if (d.sail === 'DESTROYED') return { ok: false, reason: 'sail destroyed' };
    this.inject({ type: 'SAIL_CHANGED', unitId, sail: 'DEPLOYED', tick: this.truth.tick });
    return { ok: true };
  }

  /** Emergency furl: 2 watches; on 2d6 ≤5 the accumulated charge is lost (§7.2). */
  emergencyFurlSail(unitId: Id): { ok: boolean; chargeLost?: boolean; reason?: string } {
    const d = this.truth.jumpDrives[unitId];
    if (!d || d.sail !== 'DEPLOYED') return { ok: false, reason: 'sail is not deployed' };
    const roll = this.rollLogged('2d6', `emergency sail furl ${unitId}`);
    const chargeLost = roll <= DEEPSKY.JUMP.EMERGENCY_FURL.LOSE_CHARGE_MAX;
    this.inject({ type: 'SAIL_CHANGED', unitId, sail: 'STOWED', tick: this.truth.tick });
    if (chargeLost) this.inject({ type: 'JUMP_CHARGE', unitId, chargePct: 0 });
    return { ok: true, chargeLost };
  }

  /** Quick-charge at a recharge station: 2d6 ≥8 fills in 5 watches; ≤3 hurts the drive. */
  quickCharge(unitId: Id): { ok: boolean; success?: boolean; kfDamaged?: boolean; reason?: string } {
    const d = this.truth.jumpDrives[unitId];
    if (!d) return { ok: false, reason: 'no jump drive' };
    if (d.kfDamage === 'DEAD') return { ok: false, reason: 'K-F drive is dead' };
    const roll = this.rollLogged('2d6', `quick-charge ${unitId}`);
    if (roll >= DEEPSKY.JUMP.QUICK_CHARGE.TN) {
      this.inject({ type: 'JUMP_CHARGE', unitId, chargePct: 100 });
      this.inject({ type: 'GM_NOTE', tick: this.truth.tick,
        text: `quick-charge succeeds: ${unitId} charged in ${DEEPSKY.JUMP.QUICK_CHARGE.WATCHES} watches` });
      return { ok: true, success: true, kfDamaged: false };
    }
    if (roll <= DEEPSKY.JUMP.QUICK_CHARGE.KF_DAMAGE_MAX) {
      const next = d.kfDamage === 'NONE' ? 'MINOR' : d.kfDamage === 'MINOR' ? 'MAJOR' : 'DEAD';
      this.inject({ type: 'KF_DAMAGE', unitId, kfDamage: next, tick: this.truth.tick });
      return { ok: true, success: false, kfDamaged: true };
    }
    return { ok: true, success: false, kfDamaged: false };
  }

  /**
   * Jump a vessel formation to a node (DEEP SKY §7). Needs 100% charge or a banked
   * L-F battery; pirate points gate on the survey and roll 2d6 ≥9 (≥7 surveyed),
   * ≤4 = misjump (GM's table — the throw is logged, placement is the GM's).
   */
  executeJump(formationId: Id, toNodeId: Id):
      { ok: boolean; misjump?: boolean; reason?: string } {
    const f = this.truth.formations[formationId];
    const node = this.truth.system.nodes[toNodeId];
    if (!f || f.destroyed) return { ok: false, reason: 'no such formation' };
    if (!node) return { ok: false, reason: 'no such node' };

    const drives = f.unitIds.map(uid => this.truth.jumpDrives[uid]).filter(Boolean);
    if (drives.length === 0) return { ok: false, reason: 'no K-F drive in formation' };
    for (const d of drives) {
      if (d.kfDamage === 'DEAD') return { ok: false, reason: 'K-F drive is dead' };
      if (d.sail === 'DEPLOYED') return { ok: false, reason: 'sail is deployed (furl first)' };
      if (d.chargePct < 100 && !d.lfBatteryCharged) {
        return { ok: false, reason: `drive at ${Math.floor(d.chargePct)}% and no L-F battery` };
      }
    }

    if (node.type === 'PIRATE_POINT') {
      if (node.secret && !node.surveyedBy.includes(f.sideId)) {
        return { ok: false, reason: 'pirate point solution unknown (acquire a survey)' };
      }
      const tn = node.surveyedBy.includes(f.sideId)
        ? DEEPSKY.JUMP.PIRATE_POINT.SURVEYED_TN : DEEPSKY.JUMP.PIRATE_POINT.TN;
      const roll = this.rollLogged('2d6', `pirate point jump ${formationId} → ${toNodeId} (TN ${tn})`);
      if (roll <= DEEPSKY.JUMP.PIRATE_POINT.MISJUMP_MAX) {
        this.inject({ type: 'MISJUMP', formationId, targetNodeId: toNodeId, roll,
                      tick: this.truth.tick });
        return { ok: true, misjump: true };
      }
      if (roll < tn) return { ok: false, reason: `pirate point solution failed (rolled ${roll} vs ${tn})` };
    }

    const usedLf = drives.some(d => d.chargePct < 100 && d.lfBatteryCharged);
    this.inject({ type: 'JUMP_EXECUTED', formationId, toNodeId, usedLfBattery: usedLf,
                  tick: this.truth.tick });
    // the flash announces you, system-wide, after light lag (§4.1/§7.1)
    const events: GameEvent[] = [];
    emitJumpFlash(this.truth, e => events.push(e), this.truth.formations[formationId], toNodeId);
    for (const e of events) this.inject(e);
    return { ok: true, misjump: false };
  }

  /** The geometry solution for a prospective intercept (DEEP SKY §5). */
  classifyEncounter(interceptorId: Id, targetId: Id): Classification | { error: string } {
    const interceptor = this.truth.formations[interceptorId];
    const target = this.truth.formations[targetId];
    if (!interceptor || !target) return { error: 'no such formation' };
    return classifyEncounter(this.truth, interceptor, target);
  }

  /**
   * Commit to the intercept: classify, roll SLASH duration if applicable (logged), and
   * freeze the campaign on a SPACE engagement for the capital handoff.
   */
  createSpaceEngagement(interceptorId: Id, targetId: Id):
      { ok: boolean; classification?: Classification; reason?: string } {
    if (this.truth.pendingEngagementId) return { ok: false, reason: 'an engagement is already pending' };
    const interceptor = this.truth.formations[interceptorId];
    const target = this.truth.formations[targetId];
    if (!interceptor || !target || interceptor.sideId === target.sideId) {
      return { ok: false, reason: 'need two opposing formations' };
    }
    const c = classifyEncounter(this.truth, interceptor, target);
    if (c.type === 'NO_ENGAGEMENT') {
      this.inject({ type: 'GM_NOTE', tick: this.truth.tick,
        text: `near-miss: ${interceptor.name} cannot reach ${target.name} (MM ${c.mm.toFixed(2)} vs gap ${c.gapBurnDays.toFixed(2)} burn-days) — GM eyes only` });
      return { ok: false, classification: c, reason: 'no engagement geometry' };
    }
    let slashTurns: number | undefined;
    if (c.type === 'SLASH') {
      slashTurns = DEEPSKY.CLASSIFIER.SLASH_TURNS_BASE +
        this.rollLogged('1d6', `slashing pass duration ${interceptorId} vs ${targetId}`);
    }
    const nodeId = target.pos.kind === 'node' ? target.pos.nodeId
      : interceptor.pos.kind === 'node' ? interceptor.pos.nodeId : undefined;
    const eng: Engagement = {
      id: `eng:${this.truth.tick}:space:${interceptorId}-${targetId}`,
      tick: this.truth.tick, trigger: 'SPACE_INTERCEPT', domain: 'SPACE',
      attackerSideId: interceptor.sideId, defenderSideId: target.sideId,
      attackerFormationIds: [interceptorId], defenderFormationIds: [targetId],
      status: 'PENDING',
      classification: { type: c.type, mm: c.mm, gapBurnDays: c.gapBurnDays,
                        marginBurnDays: c.marginBurnDays, slashTurns, nodeId },
    };
    this.inject({ type: 'ENGAGEMENT_TRIGGERED', engagement: eng });
    return { ok: true, classification: c };
  }

  /** A side acquires the pirate-point survey (espionage, captured nav data...). */
  surveyNode(nodeId: Id, sideId: Id): void {
    this.inject({ type: 'NODE_SURVEYED', nodeId, sideId, tick: this.truth.tick });
  }

  // ── Carrier ops: embark / disembark / carrier rearm (ext) ────────────────

  /** Embarked formations currently riding a carrier (alive, mount still set). */
  embarkedOn(carrierId: Id): Id[] {
    return Object.values(this.truth.formations)
      .filter(f => !f.destroyed && f.mounted?.carrierFormationId === carrierId)
      .map(f => f.id);
  }

  /**
   * Load a co-located formation into a carrier's bay (ext). Both must be on the ground in
   * the same hex; the carrier must have a free bay. Once embarked the payload rides along
   * (carrierPass) and cannot move, fly, or burn on its own until it disembarks or drops.
   */
  embark(carrierId: Id, payloadId: Id): { ok: true } | { ok: false; reason: string } {
    const carrier = this.truth.formations[carrierId];
    const payload = this.truth.formations[payloadId];
    if (!carrier || carrier.destroyed) return { ok: false, reason: 'no such carrier' };
    if (!carrier.carrier) return { ok: false, reason: `${carrier.name} is not a carrier` };
    if (!payload || payload.destroyed) return { ok: false, reason: 'no such formation' };
    if (payload.sideId !== carrier.sideId) return { ok: false, reason: 'not the same side' };
    if (payload.id === carrier.id) return { ok: false, reason: 'a carrier cannot embark itself' };
    if (payload.mounted) return { ok: false, reason: `${payload.name} is already embarked` };
    if (carrier.pos.kind !== 'ground' || payload.pos.kind !== 'ground') {
      return { ok: false, reason: 'both must be on the ground to load' };
    }
    if (carrier.pos.theaterId !== payload.pos.theaterId ||
        hexDistance(carrier.pos, payload.pos) !== 0) {
      return { ok: false, reason: 'must be in the carrier\'s hex to load' };
    }
    if (this.embarkedOn(carrierId).length >= carrier.carrier.bays) {
      return { ok: false, reason: `all ${carrier.carrier.bays} bays are full` };
    }
    this.inject({ type: 'MOUNT_CHANGED', formationId: payloadId, carrierFormationId: carrierId });
    this.inject({ type: 'GM_NOTE', tick: this.truth.tick,
      text: `${payload.name} embarked aboard ${carrier.name}` });
    return { ok: true };
  }

  /**
   * Unload an embarked formation onto the ground (ext). The carrier must be landed; the
   * payload steps off into the carrier's hex or an adjacent one. (Releasing over a hostile
   * hex from the air is a combat drop, not a disembark.)
   */
  disembark(payloadId: Id, target?: GroundPos): { ok: true; at: GroundPos } | { ok: false; reason: string } {
    const payload = this.truth.formations[payloadId];
    if (!payload || payload.destroyed) return { ok: false, reason: 'no such formation' };
    if (!payload.mounted) return { ok: false, reason: `${payload.name} is not embarked` };
    const carrier = this.truth.formations[payload.mounted.carrierFormationId];
    if (!carrier || carrier.destroyed) return { ok: false, reason: 'carrier is gone' };
    if (carrier.pos.kind !== 'ground') return { ok: false, reason: 'carrier must land to unload' };
    const at = target ?? { ...carrier.pos };
    if (at.theaterId !== carrier.pos.theaterId) return { ok: false, reason: 'off the carrier\'s theater' };
    const theater = this.truth.theaters[at.theaterId];
    if (!theater?.hexes[`${at.q},${at.r}`]) return { ok: false, reason: 'target hex off-map' };
    if (hexDistance(carrier.pos, at) > 1) return { ok: false, reason: 'can only step off into an adjacent hex' };
    this.inject({ type: 'MOUNT_CHANGED', formationId: payloadId, carrierFormationId: null });
    this.inject({ type: 'FORMATION_MOVED', formationId: payloadId, to: at,
                  movedKind: 'NORMAL', onRoad: false, headingDeg: 0, tick: this.truth.tick });
    this.inject({ type: 'GM_NOTE', tick: this.truth.tick,
      text: `${payload.name} disembarked from ${carrier.name} at ${at.q},${at.r}` });
    return { ok: true, at };
  }

  /**
   * Launch an embarked flight off its carrier into the air (ext). Works whether the carrier
   * is landed (the flight climbs to the theater's HIGH band) or already airborne (a mid-air
   * launch into the carrier's air hex). The flight's home becomes the carrier, so its RTB
   * and joker/bingo track the DropShip as it moves (see air.ts homeCarrierId).
   */
  launchFromCarrier(carrierId: Id, flightId: Id):
      { ok: true; pos: AirPos } | { ok: false; reason: string } {
    const carrier = this.truth.formations[carrierId];
    const flight = this.truth.formations[flightId];
    if (!carrier || carrier.destroyed) return { ok: false, reason: 'no such carrier' };
    if (!flight || flight.destroyed) return { ok: false, reason: 'no such flight' };
    if (flight.mounted?.carrierFormationId !== carrierId) {
      return { ok: false, reason: `${flight.name} is not aboard ${carrier.name}` };
    }
    if (!isFlight(this.truth, flight)) return { ok: false, reason: `${flight.name} cannot fly` };
    if (flight.air?.turnaroundReadyTick != null && this.truth.tick < flight.air.turnaroundReadyTick) {
      return { ok: false, reason: `turnaround in progress — ready at tick ${flight.air.turnaroundReadyTick}` };
    }

    let hex: { q: number; r: number };
    let altLevel: number;
    if (carrier.pos.kind === 'air') {
      hex = airQR(carrier.pos);
      altLevel = carrier.pos.altLevel;
    } else if (carrier.pos.kind === 'ground') {
      hex = theaterAirHex(this.truth, carrier.pos.theaterId);
      altLevel = SKYWATCH.CRUISE_ALT_LEVEL;
    } else {
      return { ok: false, reason: 'carrier is in space — launch there is a DEEP SKY sortie' };
    }
    const pos: AirPos = {
      kind: 'air', gridQ: hex.q, gridR: hex.r, band: 'HIGH', altLevel,
      velocity: SKYWATCH.ENTRY_VELOCITY_CRUISE, vectorDeg: 0,
    };
    // launched from a carrier already aloft: no runway climb, just the takeoff burn
    const fpPaid = carrier.pos.kind === 'ground'
      ? takeoffFp(false) + climbFp(SKYWATCH.CRUISE_ALT_LEVEL)
      : takeoffFp(false);
    this.inject({ type: 'MOUNT_CHANGED', formationId: flightId, carrierFormationId: null });
    this.inject({ type: 'FORMATION_BOOKKEEPING', formationId: flightId,
                  patch: { air: { homeCarrierId: carrierId } } });
    this.inject({ type: 'AIR_LAUNCHED', formationId: flightId, pos, fpPaid, tick: this.truth.tick });
    this.inject({ type: 'GM_NOTE', tick: this.truth.tick,
      text: `${flight.name} launched from ${carrier.name}` });
    return { ok: true, pos };
  }

  /**
   * Recover an airborne carrier-based flight back into its carrier's bay (ext). The flight
   * must be co-located with the carrier (same air hex if the carrier is aloft, over the
   * carrier's theater if it has landed) and a bay must be free. It pays the landing burn,
   * stows, and can then be rearmed via carrierRearm.
   */
  recoverToCarrier(carrierId: Id, flightId: Id):
      { ok: true } | { ok: false; reason: string } {
    const carrier = this.truth.formations[carrierId];
    const flight = this.truth.formations[flightId];
    if (!carrier || carrier.destroyed) return { ok: false, reason: 'no such carrier' };
    if (!carrier.carrier) return { ok: false, reason: `${carrier.name} is not a carrier` };
    if (!flight || flight.destroyed) return { ok: false, reason: 'no such flight' };
    if (flight.sideId !== carrier.sideId) return { ok: false, reason: 'not the same side' };
    if (flight.pos.kind !== 'air') return { ok: false, reason: `${flight.name} is not airborne` };
    if (flight.mounted) return { ok: false, reason: `${flight.name} is already stowed` };
    if (this.embarkedOn(carrierId).length >= carrier.carrier.bays) {
      return { ok: false, reason: `all ${carrier.carrier.bays} bays are full` };
    }
    const flightHex = airQR(flight.pos);
    const carrierHex = carrier.pos.kind === 'air' ? airQR(carrier.pos)
      : carrier.pos.kind === 'ground' ? theaterAirHex(this.truth, carrier.pos.theaterId)
      : null;
    if (!carrierHex) return { ok: false, reason: 'carrier is in space' };
    if (hexDistance(flightHex, carrierHex) !== 0) {
      return { ok: false, reason: 'flight must be in the carrier\'s hex to recover' };
    }
    this.inject({ type: 'FUEL_SPENT', formationId: flightId, fpPaid: landingFp(false),
                  reason: 'carrier recovery', tick: this.truth.tick });
    this.inject({ type: 'AIR_PHASE', formationId: flightId, phase: 'GROUNDED', tick: this.truth.tick });
    this.inject({ type: 'MOUNT_CHANGED', formationId: flightId, carrierFormationId: carrierId });
    this.inject({ type: 'MOUNT_MOVED', formationId: flightId,
                  pos: structuredClone(carrier.pos), tick: this.truth.tick });
    this.inject({ type: 'GM_NOTE', tick: this.truth.tick,
      text: `${flight.name} recovered aboard ${carrier.name}` });
    return { ok: true };
  }

  /**
   * Rearm & refuel a recovered flight from the carrier itself (ext) — the turnaround story
   * without a ground facility. Draws aviation fuel from the carrier's `avFuelTons` and ties
   * up one of its `crews` for the standard turnaround; the flight's fuel and ammo top off
   * when the crew finishes at `readyTick`.
   */
  carrierRearm(carrierId: Id, flightId: Id):
      { ok: true; readyTick: number; tonsDrawn: number } | { ok: false; reason: string } {
    const carrier = this.truth.formations[carrierId];
    const flight = this.truth.formations[flightId];
    if (!carrier || carrier.destroyed || !carrier.carrier) return { ok: false, reason: 'no such carrier' };
    if (!flight || flight.destroyed) return { ok: false, reason: 'no such flight' };
    if (flight.mounted?.carrierFormationId !== carrierId) {
      return { ok: false, reason: `${flight.name} must be recovered aboard ${carrier.name}` };
    }
    if (flight.unitIds.length > SKYWATCH.CREW_FLIGHT_MAX_AIRCRAFT) {
      return { ok: false, reason: `a crew handles at most ${SKYWATCH.CREW_FLIGHT_MAX_AIRCRAFT} aircraft` };
    }
    const busy = (carrier.carrier.crewBusyUntil ?? []).filter(t => t > this.truth.tick).length;
    if (busy >= carrier.carrier.crews) return { ok: false, reason: 'all carrier crews busy' };

    const fpNeeded = flight.unitIds.reduce((sum, uid) => {
      const fuel = this.truth.units[uid]?.fuel;
      return fuel ? sum + Math.max(0, fuel.tons * fuel.fpPerTon - fuel.fp) : sum;
    }, 0);
    const tonsDrawn = fpNeeded / SKYWATCH.FP_PER_TON;
    if (tonsDrawn > carrier.carrier.avFuelTons + 1e-9) {
      return { ok: false, reason: `carrier holds ${carrier.carrier.avFuelTons.toFixed(2)} t av fuel, need ${tonsDrawn.toFixed(2)} t` };
    }
    const readyTick = this.truth.tick + SKYWATCH.TURNAROUND_PULSES * CLOCK.TICKS_PER_PULSE;
    this.inject({ type: 'CARRIER_TURNAROUND_STARTED', carrierId, formationId: flightId,
                  readyTick, tonsDrawn, tick: this.truth.tick });
    this.inject({ type: 'GM_NOTE', tick: this.truth.tick,
      text: `${carrier.name} rearming ${flight.name} (${tonsDrawn.toFixed(2)} t, ready @ ${readyTick})` });
    return { ok: true, readyTick, tonsDrawn };
  }

  // ── M8: combat drops & the false-flag game ──────────────────────────────

  /**
   * Combat drop (core §8.3): a carrier releases an embarked formation onto a target hex.
   * Scatter = 1d6 hexes in a random direction, reduced by the carrier's Piloting margin,
   * +2 in a storm; the dropped formation arrives at LOCK visibility to everyone watching
   * the sky. Returns the landing hex and the scatter applied.
   */
  combatDrop(carrierId: Id, payloadId: Id, target: GroundPos):
      { ok: true; landing: GroundPos; scatter: number } | { ok: false; reason: string } {
    const carrier = this.truth.formations[carrierId];
    const payload = this.truth.formations[payloadId];
    if (!carrier || carrier.destroyed) return { ok: false, reason: 'no such carrier' };
    if (!payload || payload.destroyed) return { ok: false, reason: 'no such payload' };
    if (payload.sideId !== carrier.sideId) return { ok: false, reason: 'payload is not the carrier\'s' };
    const theater = this.truth.theaters[target.theaterId];
    if (!theater?.hexes[`${target.q},${target.r}`]) return { ok: false, reason: 'target hex off-map' };

    const piloting = (() => {
      for (const uid of carrier.unitIds) {
        const p = this.truth.units[uid]?.pilotIds.map(id => this.truth.pilots[id]).find(Boolean);
        if (p) return p.piloting;
      }
      return COMBAT_DROP.PILOTING_TN;
    })();
    const psr = this.rollLogged('2d6', `drop piloting ${carrier.name}`);
    const dist = this.rollLogged('1d6', `drop scatter distance ${carrier.name}`);
    const dirRoll = this.rollLogged('1d6', `drop scatter direction ${carrier.name}`);
    const margin = Math.max(0, psr - piloting);
    let scatter = Math.max(0, dist - margin);
    if (this.truth.config.weather === 'STORM') scatter += COMBAT_DROP.STORM_OR_ECM_SCATTER;

    // dropping into an AA umbrella (ext): worse scatter, and the batteries get their shots
    const flakUp = flakBatteriesNear(this.truth, payload.sideId, target).length > 0;
    if (flakUp) scatter += FLAK.DROP_SCATTER_EXTRA;

    const dir = AXIAL_DIRECTIONS[(dirRoll - 1) % 6];
    let landing: GroundPos = { ...target, q: target.q + dir.q * scatter, r: target.r + dir.r * scatter };
    if (!theater.hexes[`${landing.q},${landing.r}`]) landing = { ...target }; // off-map ⇒ on target

    if (payload.mounted) this.inject({ type: 'MOUNT_CHANGED', formationId: payloadId, carrierFormationId: null });
    if (flakUp) flakGauntlet(this.truth, e => this.inject(e), payload, { ...target }, 'drop pass');
    this.inject({ type: 'FORMATION_MOVED', formationId: payloadId, to: landing,
                  movedKind: 'NORMAL', onRoad: false, headingDeg: 0, tick: this.truth.tick });
    // "dropping troops arrive at LOCK-level visibility to anyone watching the sky"
    for (const sideId of Object.keys(this.truth.sides)) {
      if (sideId === payload.sideId) continue;
      this.inject({ type: 'CONTACT_UPGRADED', contact: this.contactAt(sideId, payloadId, LADDER.MAX_LEVEL),
                    tick: this.truth.tick });
    }
    this.inject({ type: 'GM_NOTE', tick: this.truth.tick,
      text: `${carrier.name} dropped ${payload.name} at ${target.q},${target.r} — scattered ${scatter} to ${landing.q},${landing.r}` });
    return { ok: true, landing, scatter };
  }

  /**
   * Customs inspection of a transponder claim (DEEP SKY §4.3): a picket resolves a
   * contact's squawk. The lie holds on 2d6 ≥ 9 — but a vessel maneuvering like a warship
   * (a 1G+ burn in progress) fails automatically. Failure reveals its true nature
   * (LOCK) and drops the false flag.
   */
  inspectTransponder(targetId: Id, bySideId: Id):
      { ok: true; held: boolean } | { ok: false; reason: string } {
    const target = this.truth.formations[targetId];
    if (!target || target.destroyed) return { ok: false, reason: 'no such contact' };
    if (!target.squawk) return { ok: false, reason: 'nothing being squawked' };
    const burningHard = target.space?.burnStartTick != null;
    let held: boolean;
    if (burningHard) {
      this.inject({ type: 'GM_NOTE', tick: this.truth.tick,
        text: `${target.name} maneuvers like a warship — the merchant squawk fails automatically` });
      held = false;
    } else {
      const roll = this.rollLogged('2d6', `false-flag inspection of ${target.squawk}`);
      held = roll >= DEEPSKY.FALSE_FLAG_TN;
    }
    if (!held) {
      this.inject({ type: 'TRANSPONDER_REVEALED', formationId: targetId, tick: this.truth.tick });
      this.inject({ type: 'CONTACT_UPGRADED', contact: this.contactAt(bySideId, targetId, LADDER.MAX_LEVEL),
                    tick: this.truth.tick });
    }
    return { ok: true, held };
  }

  /**
   * SAR (SKYWATCH §8.4): a recoverer at a downed-crew marker's hex picks the crew up —
   * the pilot returns to the POOL and the marker is cleared.
   */
  recoverDownedCrew(recovererId: Id, markerId: Id): { ok: boolean; pilotId?: Id; reason?: string } {
    const r = this.truth.formations[recovererId];
    const m = this.truth.markers[markerId];
    if (!r || r.destroyed) return { ok: false, reason: 'no such recoverer' };
    if (!m || m.kind !== 'DOWNED_CREW') return { ok: false, reason: 'no such downed crew' };
    const co = (a: { kind: string }, b: { kind: string }) =>
      a.kind === 'ground' && b.kind === 'ground' &&
      (a as GroundPos).theaterId === (b as GroundPos).theaterId &&
      (a as GroundPos).q === (b as GroundPos).q && (a as GroundPos).r === (b as GroundPos).r;
    if (!co(r.pos, m.pos)) return { ok: false, reason: 'recoverer is not at the crew\'s hex' };
    const pilotId = m.payload?.pilotId as Id | undefined;
    if (pilotId && this.truth.pilots[pilotId]) {
      this.inject({ type: 'PILOT_STATE_CHANGED', pilotId, status: 'POOL' });
    }
    this.inject({ type: 'MARKER_REMOVED', markerId });
    this.inject({ type: 'GM_NOTE', tick: this.truth.tick,
      text: `${r.name} recovered downed crew at ${(m.pos as GroundPos).q},${(m.pos as GroundPos).r}` });
    return { ok: true, pilotId };
  }

  /**
   * TANKER (SKYWATCH §4): a tanker delivers fuel to another flight — 1 ton delivered per
   * 2 carried (TANKER_DELIVERY_RATIO). Adds FP to the receiver, burns tons from the tanker.
   */
  transferFuel(tankerId: Id, receiverId: Id, tonsOffloaded: number):
      { ok: boolean; fpDelivered?: number; reason?: string } {
    const tanker = this.truth.formations[tankerId];
    const recv = this.truth.formations[receiverId];
    if (!tanker || !recv) return { ok: false, reason: 'no such formation' };
    const tankUnit = tanker.unitIds.map(id => this.truth.units[id]).find(u => u.fuel);
    const recvUnit = recv.unitIds.map(id => this.truth.units[id]).find(u => u.fuel);
    if (!tankUnit?.fuel || !recvUnit?.fuel) return { ok: false, reason: 'no fuel ledger to transfer' };
    const tons = Math.min(tonsOffloaded, tankUnit.fuel.tons);
    const fp = Math.round(tons * SKYWATCH.TANKER_DELIVERY_RATIO * recvUnit.fuel.fpPerTon);
    this.inject({ type: 'TONS_BURNED', formationId: tankerId, tons, reason: 'tanker offload',
                  tick: this.truth.tick });
    this.inject({ type: 'UNIT_STATE_CHANGED', unitId: recvUnit.id, damage: recvUnit.damage,
                  ammoState: recvUnit.ammoState, fpRemaining: recvUnit.fuel.fp + fp });
    return { ok: true, fpDelivered: fp };
  }

  /**
   * Resolve one hauled salvage token at a depot: 2d6 ≥8 ⇒ unit, else parts (core §10.4).
   * The career loop closes both ends (ext): a UNIT outcome queues a refit project — the
   * wreck can be rebuilt into the recoverer's roster via startRefit — and a PARTS outcome
   * credits SALVAGE_FAIL_SP to a friendly depot in the wreck's hex (if any).
   */
  resolveSalvage(tokenId: Id): { outcome: 'UNIT' | 'PARTS'; refitId?: Id } | { error: string } {
    const token = this.truth.salvage[tokenId];
    if (!token) return { error: 'no such salvage token' };
    const roll = this.rollLogged('2d6', `salvage recovery ${tokenId}`);
    const outcome = roll >= SUPPLY.SALVAGE_RECOVER_TN ? 'UNIT' : 'PARTS';
    const src = this.truth.units[token.sourceUnitId];
    const sideId = token.heldBy;
    this.inject({ type: 'SALVAGE_RESOLVED', tokenId, outcome, tick: this.truth.tick });

    if (outcome === 'UNIT' && src && sideId) {
      const refitId = `refit:${tokenId}`;
      this.inject({ type: 'REFIT_QUEUED', refit: {
        id: refitId, sideId, sourceUnitId: token.sourceUnitId,
        model: src.model, name: src.name, hex: { ...token.hex }, status: 'AWAITING',
      }, tick: this.truth.tick });
      this.inject({ type: 'GM_NOTE', tick: this.truth.tick,
        text: `${src.name} (${src.model}) recovered intact — awaiting refit` });
      return { outcome, refitId };
    }
    if (outcome === 'PARTS' && sideId) {
      const depot = Object.values(this.truth.facilities).find(fac =>
        fac.sideId === sideId && fac.pos.kind === 'ground' &&
        fac.pos.theaterId === token.hex.theaterId &&
        fac.pos.q === token.hex.q && fac.pos.r === token.hex.r &&
        CAREER.REPAIR_FACILITY_TAGS.some(t => (fac.tags as string[]).includes(t)));
      if (depot) {
        this.inject({ type: 'SP_CHANGED', facilityId: depot.id, delta: SUPPLY.SALVAGE_FAIL_SP,
                      reason: `stripped ${src?.name ?? token.sourceUnitId} for parts` });
      }
    }
    return { outcome };
  }

  /**
   * Start rebuilding a recovered wreck (ext): a repair-capable facility of the refit's side
   * spends REFIT.SP and REFIT.DAYS; on completion careerPass delivers the unit — crewed by
   * a POOL pilot when one is waiting — into the chosen formation.
   */
  startRefit(refitId: Id, facilityId: Id, formationId: Id):
      { ok: true; readyTick: number } | { ok: false; reason: string } {
    const refit = this.truth.refits?.[refitId];
    if (!refit) return { ok: false, reason: 'no such refit project' };
    if (refit.status !== 'AWAITING') return { ok: false, reason: 'refit already under way' };
    const fac = this.truth.facilities[facilityId];
    if (!fac || fac.sideId !== refit.sideId) return { ok: false, reason: 'no such friendly facility' };
    if (!CAREER.REPAIR_FACILITY_TAGS.some(t => (fac.tags as string[]).includes(t))) {
      return { ok: false, reason: `${fac.name} cannot rebuild units (needs ${CAREER.REPAIR_FACILITY_TAGS.join('/')})` };
    }
    if (fac.supplyPoints < CAREER.REFIT.SP) {
      return { ok: false, reason: `refit needs ${CAREER.REFIT.SP} SP, ${fac.name} holds ${fac.supplyPoints}` };
    }
    const formation = this.truth.formations[formationId];
    if (!formation || formation.destroyed || formation.sideId !== refit.sideId) {
      return { ok: false, reason: 'no such friendly formation to deliver to' };
    }
    const readyTick = this.truth.tick + CAREER.REFIT.DAYS * CLOCK.TICKS_PER_DAY;
    this.inject({ type: 'SP_CHANGED', facilityId, delta: -CAREER.REFIT.SP,
                  reason: `refitting ${refit.name}` });
    this.inject({ type: 'REFIT_STARTED', refitId, facilityId, formationId, readyTick,
                  tick: this.truth.tick });
    return { ok: true, readyTick };
  }

  /**
   * Put a DAMAGED/CRIPPLED unit in the shop (ext). Needs its formation co-located with a
   * friendly repair-capable facility (draws the repair SP), or embarked in a carrier with
   * a free crew (the crew is tied up for the duration). careerPass completes it.
   */
  repairUnit(unitId: Id): { ok: true; readyTick: number } | { ok: false; reason: string } {
    const u = this.truth.units[unitId];
    if (!u) return { ok: false, reason: 'no such unit' };
    if (u.damage !== 'DAMAGED' && u.damage !== 'CRIPPLED') {
      return { ok: false, reason: `${u.name} is ${u.damage} — nothing a shop can fix` };
    }
    if (u.repairReadyTick != null) return { ok: false, reason: `${u.name} is already in the shop` };
    const formation = Object.values(this.truth.formations).find(f =>
      !f.destroyed && f.unitIds.includes(unitId));
    if (!formation) return { ok: false, reason: 'unit is not in a live formation' };
    const cost = CAREER.REPAIR[u.damage];
    const readyTick = this.truth.tick + cost.DAYS * CLOCK.TICKS_PER_DAY;

    // option 1: a repair-capable friendly facility in the formation's hex
    if (formation.pos.kind === 'ground') {
      const here = formation.pos;
      const fac = Object.values(this.truth.facilities).find(x =>
        x.sideId === formation.sideId && x.pos.kind === 'ground' &&
        x.pos.theaterId === here.theaterId && x.pos.q === here.q && x.pos.r === here.r &&
        CAREER.REPAIR_FACILITY_TAGS.some(t => (x.tags as string[]).includes(t)));
      if (fac) {
        if (fac.supplyPoints < cost.SP) {
          return { ok: false, reason: `repair needs ${cost.SP} SP, ${fac.name} holds ${fac.supplyPoints}` };
        }
        this.inject({ type: 'SP_CHANGED', facilityId: fac.id, delta: -cost.SP,
                      reason: `repairing ${u.name}` });
        this.inject({ type: 'REPAIR_STARTED', unitId, readyTick, facilityId: fac.id,
                      tick: this.truth.tick });
        return { ok: true, readyTick };
      }
    }
    // option 2: embarked in a carrier with a free turnaround crew
    if (formation.mounted) {
      const carrier = this.truth.formations[formation.mounted.carrierFormationId];
      if (carrier && !carrier.destroyed && carrier.carrier) {
        const busy = (carrier.carrier.crewBusyUntil ?? []).filter(t => t > this.truth.tick).length;
        if (busy >= carrier.carrier.crews) return { ok: false, reason: 'all carrier crews busy' };
        this.inject({ type: 'REPAIR_STARTED', unitId, readyTick, carrierId: carrier.id,
                      tick: this.truth.tick });
        return { ok: true, readyTick };
      }
    }
    return { ok: false, reason: 'needs a friendly depot/factory/spaceport in the hex, or a carrier bay' };
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
    const pos = structuredClone(f.pos);
    return {
      id: `contact:${observerSideId}:${targetFormationId}`, observerSideId, targetFormationId,
      kind: 'STANDARD' as const, level: level as 0 | 1 | 2 | 3 | 4,
      lastConfirmedTick: this.truth.tick, lastFadeTick: this.truth.tick,
      estPos: pos, posErrorHexes: 0, staleAsOfTick: this.truth.tick,
      delivered: { level: level as 0 | 1 | 2 | 3 | 4, estPos: structuredClone(pos), posErrorHexes: 0,
                   estVector: f.lastHeadingDeg,
                   estSizeClass: undefined, estComposition: undefined,
                   asOfTick: this.truth.tick },
    };
  }
}
