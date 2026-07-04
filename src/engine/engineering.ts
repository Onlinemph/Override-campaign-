/**
 * engine/engineering.ts — the engineer toolkit & minefields (core §9.3).
 *
 *   LAY_MINES    — drop a hidden minefield in the engineer's hex (1 pulse)
 *   BREACH       — clear a minefield in the hex (2 pulses)
 *   DEMOLISH     — blow a BRIDGE/RAIL tag (instant, loud: SIG −3 that turn)
 *   BUILD_BRIDGE — lay a BRIDGE tag (4 pulses)
 *
 * D-045: sappers work from the bank. DEMOLISH and BUILD_BRIDGE take an optional
 * targetHex; when it names an ADJACENT hex the work happens there — a ground
 * engineer can span open water it could never drive into, and a demo team can
 * drop a span without standing on it when it goes. A target farther than one hex
 * simply stalls the order (stall.ts says why). No targetHex ⇒ the engineer's own
 * hex, as before. LAY_MINES and BREACH stay own-hex: you sow or sweep ground you
 * physically hold.
 *
 * And the payoff: an enemy that moves into a mined hex takes a Quick-Resolution hit
 * (core §9.3, BR 3) — the minefield is revealed when it bites. Only ENGINEER-tagged
 * formations can run the toolkit.
 */
import { CLOCK, ENGINEERING } from '../rules.js';
import type { DamageState, Formation, GroundPos, Id, TruthState } from '../core/types.js';
import { hexKey } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { rollDice } from '../core/rng.js';
import { hexDistance } from '../hex/axial.js';

const DAMAGE_STEPS: DamageState[] = ['OK', 'DAMAGED', 'CRIPPLED', 'DESTROYED'];
function worsen(cur: DamageState, n: number): DamageState {
  const i = DAMAGE_STEPS.indexOf(cur);
  return i < 0 ? cur : DAMAGE_STEPS[Math.min(DAMAGE_STEPS.length - 1, i + n)];
}
function isEngineer(s: TruthState, f: Formation): boolean {
  return f.unitIds.some(uid => s.units[uid]?.tags.includes('ENGINEER'));
}
function isSoft(s: TruthState, f: Formation): boolean {
  return f.unitIds.length > 0 && f.unitIds.every(uid =>
    ['INFANTRY', 'BA', 'VEHICLE', 'SUPPORT'].includes(s.units[uid]?.class ?? ''));
}
const ENG_KINDS = new Set(['LAY_MINES', 'BREACH', 'DEMOLISH', 'BUILD_BRIDGE']);

export function engineeringPass(s: TruthState, dt: number, emit: (e: GameEvent) => void): void {
  const pulses = dt / CLOCK.TICKS_PER_PULSE;

  // ── minefields bite movers (core §9.3) — checked first, on freshly-entered hexes ──
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.pos.kind !== 'ground') continue;
    if (!f.transient || f.transient.moved === 'NONE') continue; // only on entering
    const here = f.pos as GroundPos;
    const hex = s.theaters[here.theaterId]?.hexes[hexKey(here.q, here.r)];
    if (!hex?.minefieldIds.length) continue;
    for (const mineId of [...hex.minefieldIds]) {
      const mine = s.markers[mineId];
      if (!mine || mine.sideId === f.sideId) continue; // your own mines don't bite you
      const r = rollDice(s.seed, s.seedCursor, '2d6');
      emit({ type: 'DIE_ROLLED', roll: { id: `roll:${s.seedCursor}`, tick: s.tick,
        purpose: `minefield bite vs ${f.name} at ${here.q},${here.r} (2d6 ${r.result} ≥ 7?)`,
        dice: '2d6', result: r.result, seedCursor: r.nextCursor - 2 } });
      if (r.result >= 7) {
        const steps = 1 + (isSoft(s, f) ? 1 : 0);
        const uid = f.unitIds.find(u => s.units[u]?.damage !== 'DESTROYED' && s.units[u]?.damage !== 'SALVAGE');
        if (uid) emit({ type: 'UNIT_STATE_CHANGED', unitId: uid,
          damage: worsen(s.units[uid].damage, steps), ammoState: s.units[uid].ammoState });
        emit({ type: 'GM_NOTE', tick: s.tick,
          text: `minefield revealed: ${f.name} struck mines at ${here.q},${here.r}` });
      }
    }
  }

  // ── the engineer toolkit (pulse-paced tasks) ──
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.pos.kind !== 'ground') continue;
    const order = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;
    if (!order || order.completed || !ENG_KINDS.has(order.kind)) continue;
    if (!isEngineer(s, f)) { // a non-engineer can't run the toolkit — drop the order
      emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
      continue;
    }
    const here = f.pos as GroundPos;
    const hex = s.theaters[here.theaterId]?.hexes[hexKey(here.q, here.r)];
    if (!hex) continue;

    // D-045: DEMOLISH/BUILD_BRIDGE may name an adjacent work site; too far ⇒ stall
    let work = here;
    if (order.kind === 'DEMOLISH' || order.kind === 'BUILD_BRIDGE') {
      const t = order.targetHex;
      if (t?.kind === 'ground' && (t.q !== here.q || t.r !== here.r)) {
        if (t.theaterId !== here.theaterId || hexDistance(here, t) > 1) continue;
        work = t;
      }
    }
    const workHex = s.theaters[work.theaterId]?.hexes[hexKey(work.q, work.r)];
    if (!workHex) continue;

    if (order.kind === 'DEMOLISH') {
      // instant & loud: strip BRIDGE/RAIL, flag the engineer as having made noise
      const next = workHex.infra.filter(t => t !== 'BRIDGE' && t !== 'RAIL');
      if (next.length !== workHex.infra.length) {
        emit({ type: 'HEX_INFRA_CHANGED', theaterId: work.theaterId,
          hexKey: hexKey(work.q, work.r), infra: next });
        emit({ type: 'FORMATION_FIRED', formationId: f.id, tick: s.tick }); // SIG −3, loud
        emit({ type: 'GM_NOTE', tick: s.tick, text: `${f.name} demolished a span at ${work.q},${work.r}` });
      }
      emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
      continue;
    }

    // timed tasks accumulate pulses
    const need = order.kind === 'LAY_MINES' ? 1
      : order.kind === 'BREACH' ? ENGINEERING.BREACH_PULSES
      : ENGINEERING.BUILD_BRIDGE_PULSES;
    const acc = (f.engPulseAcc ?? 0) + pulses;
    if (acc >= need - 1e-9) {
      if (order.kind === 'LAY_MINES') {
        const id = `mine:${f.id}:${s.tick}`;
        emit({ type: 'MARKER_ADDED', marker: { id, kind: 'MINEFIELD',
          pos: { ...here }, sideId: f.sideId, payload: {} } });
      } else if (order.kind === 'BREACH') {
        for (const mineId of [...hex.minefieldIds]) emit({ type: 'MARKER_REMOVED', markerId: mineId });
      } else { // BUILD_BRIDGE
        if (!workHex.infra.includes('BRIDGE')) emit({ type: 'HEX_INFRA_CHANGED',
          theaterId: work.theaterId, hexKey: hexKey(work.q, work.r),
          infra: [...workHex.infra, 'BRIDGE'] });
      }
      emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
      emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id, patch: { engPulseAcc: 0 } });
    } else {
      emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id, patch: { engPulseAcc: acc } });
    }
  }
}
