/**
 * engine/flak.ts — the AA gauntlet (ext).
 *
 * The air grid is one hex per theater, so ground AA cannot touch HIGH-band transit;
 * it engages aircraft coming LOW over a specific hex — launching, landing, or making a
 * drop pass. Every enemy formation with a live 'AA'-tagged unit within FLAK.RANGE_HEXES
 * gets one logged 2d6: a hit degrades the aircraft one damage step (OK → DAMAGED →
 * CRIPPLED — flak batters, it does not one-shot). And firing is loud: the battery is
 * revealed at CONTACT to the aircraft's side, the same bargain as counter-battery
 * (core §9.2) — an AA umbrella is a trap you spring, not a passive wall.
 */
import { FLAK, LADDER } from '../rules.js';
import type { DamageState, Formation, GroundPos, TruthState } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { hexDistance } from '../hex/axial.js';
import { rollDice } from '../core/rng.js';
import { registerDetection } from './detection.js';

/** Enemy formations with a live AA unit whose umbrella covers `hex`. Deterministic order. */
export function flakBatteriesNear(
  s: TruthState, targetSideId: string, hex: GroundPos,
): Formation[] {
  return Object.values(s.formations)
    .filter(f =>
      !f.destroyed && !f.mounted && f.sideId !== targetSideId &&
      f.pos.kind === 'ground' && f.pos.theaterId === hex.theaterId &&
      hexDistance(f.pos, hex) <= FLAK.RANGE_HEXES &&
      f.unitIds.some(uid => {
        const u = s.units[uid];
        return u && u.tags.includes('AA') && u.damage !== 'DESTROYED' && u.damage !== 'SALVAGE';
      }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const DEGRADE: Partial<Record<DamageState, DamageState>> = {
  OK: 'DAMAGED', DAMAGED: 'CRIPPLED',
};

/**
 * Run the gauntlet: `target` transitions low over `hex` (launch, landing, drop pass).
 * Emits the logged rolls, any damage, the reveals, and a GM note per hit.
 */
export function flakGauntlet(
  s: TruthState, emit: (e: GameEvent) => void,
  target: Formation, hex: GroundPos, context: string,
): void {
  const batteries = flakBatteriesNear(s, target.sideId, hex);
  for (const battery of batteries) {
    const r = rollDice(s.seed, s.seedCursor, '2d6');
    emit({ type: 'DIE_ROLLED', roll: {
      id: `roll:${s.seedCursor}`, tick: s.tick,
      purpose: `flak ${battery.name} → ${target.name} (${context}, TN ${FLAK.TN})`,
      dice: '2d6', result: r.result, seedCursor: r.nextCursor - 2 } });

    if (r.result >= FLAK.TN) {
      // one damage step on the first live unit — deterministic pick
      const uid = target.unitIds.find(id => {
        const u = s.units[id];
        return u && DEGRADE[u.damage] !== undefined;
      });
      if (uid) {
        const u = s.units[uid];
        emit({ type: 'UNIT_STATE_CHANGED', unitId: uid,
               damage: DEGRADE[u.damage]!, ammoState: u.ammoState });
      }
      emit({ type: 'GM_NOTE', tick: s.tick,
        text: `flak: ${battery.name} hit ${target.name} on the ${context}` });
    }
    // shoot and be seen: the aircrew spot the battery — delivery follows their net status
    registerDetection(s, emit, target.sideId, battery,
      Math.min(LADDER.MAX_LEVEL, FLAK.REVEAL_LEVEL),
      { id: target.id, name: target.name, alwaysOnNet: false },
      { setLevel: true, note: 'AA battery firing position' });
  }
}
