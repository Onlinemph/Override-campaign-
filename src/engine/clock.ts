/**
 * engine/clock.ts — clock-mode selection & day/night (core §2; spec §3.1).
 */
import { CLOCK, CONTACT_MODE_RANGE_HEXES, SKYWATCH } from '../rules.js';
import type { AirPos, ClockMode, TruthState } from '../core/types.js';
import { hexDistance } from '../hex/axial.js';
import { AIR_MISSIONS, isLaunchPending } from './air.js';

export function isNight(s: TruthState, tick: number): boolean {
  const tod = ((tick % CLOCK.TICKS_PER_DAY) + CLOCK.TICKS_PER_DAY) % CLOCK.TICKS_PER_DAY;
  return tod < s.config.dawnTick || tod >= s.config.duskTick;
}

export function ticksFor(mode: ClockMode): number {
  return mode === 'CONTACT' ? 1 : mode === 'PULSE' ? CLOCK.TICKS_PER_PULSE : CLOCK.TICKS_PER_WATCH;
}

/**
 * CONTACT if any cross-side pair is within 5 op-hexes AND at least one of the pair's
 * sides holds ladder ≥1 on the other formation; PULSE if any theater has active ground
 * ops (D-008.8: any incomplete order or any live contact); else WATCH.
 */
export function chooseClockMode(s: TruthState): ClockMode {
  const live = Object.values(s.formations).filter(f => !f.destroyed);

  for (const a of live) {
    for (const b of live) {
      if (a.sideId === b.sideId) continue;
      if (a.pos.kind !== 'ground' || b.pos.kind !== 'ground') continue;
      if (a.pos.theaterId !== b.pos.theaterId) continue;
      if (hexDistance(a.pos, b.pos) > CONTACT_MODE_RANGE_HEXES) continue;
      const known = Object.values(s.contacts).some(c =>
        c.level >= 1 &&
        ((c.observerSideId === a.sideId && c.targetFormationId === b.id) ||
         (c.observerSideId === b.sideId && c.targetFormationId === a.id)));
      if (known) return 'CONTACT';
    }
  }

  // M3 (SKYWATCH §6, D-010.7): scrambles and chases run in contact turns —
  // a pending launch, or an airborne formation near the enemy (their flights, or the
  // sky over a theater they occupy) drops the clock to contact pace.
  const enemyAirHexesBySide = new Map<string, Array<{ q: number; r: number }>>();
  for (const sideId of Object.keys(s.sides)) {
    const hexes: Array<{ q: number; r: number }> = [];
    for (const t of Object.keys(s.theaters)) {
      const occupied =
        live.some(f => f.sideId !== sideId && f.pos.kind === 'ground' && f.pos.theaterId === t) ||
        Object.values(s.facilities).some(fac =>
          fac.sideId !== sideId && fac.pos.kind === 'ground' && fac.pos.theaterId === t);
      if (occupied) hexes.push(s.config.airHexByTheater?.[t] ?? { q: 0, r: 0 });
    }
    enemyAirHexesBySide.set(sideId, hexes);
  }
  for (const f of live) {
    if (isLaunchPending(s, f)) return 'CONTACT'; // scramble in progress
    if (f.pos.kind !== 'air') continue;
    // an active chase runs in contact turns (§6: "on the grid, in contact turns")
    const order = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;
    if (order && !order.completed && AIR_MISSIONS.has(order.kind) &&
        order.targetContactId && (s.contacts[order.targetContactId]?.level ?? 0) >= 1) {
      return 'CONTACT';
    }
    const here = { q: f.pos.gridQ, r: f.pos.gridR };
    for (const g of live) {
      if (g.sideId === f.sideId || g.pos.kind !== 'air') continue;
      const there = { q: (g.pos as AirPos).gridQ, r: (g.pos as AirPos).gridR };
      if (hexDistance(here, there) <= SKYWATCH.AIR_CONTACT_CLOCK_RANGE) return 'CONTACT';
    }
    for (const hex of enemyAirHexesBySide.get(f.sideId) ?? []) {
      if (hexDistance(here, hex) <= SKYWATCH.AIR_CONTACT_CLOCK_RANGE) return 'CONTACT';
    }
  }

  // PULSE if any theater has active ground/air ops; pure system-scale activity runs
  // in Watches ("the GM tool runs Watches until an event demands finer time",
  // DEEP SKY §1.1) — space contacts and transits do not by themselves tighten the clock.
  const SPACE_KINDS = new Set(['TRANSIT', 'COLD_COAST', 'STATION_KEEP', 'INTERCEPT',
    'SKIM_FUEL', 'RECHARGE_SAIL', 'QUICK_CHARGE', 'JUMP', 'INSPECT', 'BLOCKADE', 'BOARD']);
  const groundAirOps =
    Object.values(s.orders).some(o => !o.completed && !SPACE_KINDS.has(o.kind) &&
      !s.formations[o.formationId]?.destroyed) ||
    Object.values(s.contacts).some(c => c.level >= 1 &&
      (c.estPos.kind === 'ground' || c.estPos.kind === 'air'));
  return groundAirOps ? 'PULSE' : 'WATCH';
}
