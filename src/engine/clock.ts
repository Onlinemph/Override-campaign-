/**
 * engine/clock.ts — clock-mode selection & day/night (core §2; spec §3.1).
 */
import { CLOCK, CONTACT_MODE_RANGE_HEXES } from '../rules.js';
import type { ClockMode, TruthState } from '../core/types.js';
import { hexDistance } from '../hex/axial.js';

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

  const activeOps =
    Object.values(s.orders).some(o => !o.completed && !s.formations[o.formationId]?.destroyed) ||
    Object.values(s.contacts).some(c => c.level >= 1);
  return activeOps ? 'PULSE' : 'WATCH';
}
