/**
 * engine/flak.ts — the AA gauntlet & anti-capital emplacements (ext, D-050).
 *
 * TACTICAL FLAK: ground AA engages aircraft coming LOW over a specific hex —
 * launching, landing, or making a drop pass. Every enemy formation with a live
 * 'AA'-tagged unit within FLAK.RANGE_HEXES gets one logged 2d6, and the battery
 * is GRADED BY ITS REAL GUNS: each AA unit carries a `flak` strength derived
 * from the weapons on its record sheet (LB-X/RAC/HAG double, autocannons single;
 * a bare authored AA tag is an improvised battery of 1). Battery strength sets
 * the TN (9 down to 6) and a massed battery degrades two steps per hit — but
 * tactical flak still batters, it does not one-shot (caps at CRIPPLED). Firing
 * is loud: the battery is revealed at CONTACT, the counter-battery bargain.
 *
 * ANTI-CAPITAL EMPLACEMENTS (D-050.1 — REAL Total Warfare stats, 1:1: a TW
 * space/high-altitude hex is 18 km, exactly our operational hex): a facility
 * with a `capitalBattery` mounts an actual capital or sub-capital weapon from
 * rules.CAPITAL_WEAPONS. It engages CAPITAL HULLS (DropShips, small craft,
 * jump-capables — sub-capital weapons and the Barracuda can also track
 * fighters) transitioning through or flying inside its printed range bands,
 * one shot per battery per step, to-hit by band (short 5+ … extreme 11+), and
 * unlike tactical flak it CAN destroy: a Killer Whale hit is three damage
 * steps. Magazines are finite (energy mounts excepted), and a battery whose
 * hex is held by an enemy ground formation is silenced — you take the guns by
 * taking the ground. This is what denies a landing on top of what matters.
 */
import { CAPITAL_TN_BY_BAND, CAPITAL_WEAPONS, FLAK, LADDER } from '../rules.js';
import type { DamageState, Facility, Formation, GroundPos, TruthState } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { hexDistance } from '../hex/axial.js';
import { rollDice } from '../core/rng.js';
import { registerDetection } from './detection.js';
import { spotFacility } from './net.js';
import { airHexOver } from './air.js';

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

/** D-050: the battery's punch — Σ flak strength over its live AA units. */
export function flakStrength(s: TruthState, battery: Formation): number {
  let total = 0;
  for (const uid of battery.unitIds) {
    const u = s.units[uid];
    if (!u || !u.tags.includes('AA') || u.damage === 'DESTROYED' || u.damage === 'SALVAGE') continue;
    total += u.flak ?? 1;
  }
  return total;
}

/** The TN this battery's guns actually hit on (graded, floored). */
export function flakTn(strength: number): number {
  return Math.max(FLAK.TN_FLOOR, FLAK.TN_BASE - Math.floor(strength / FLAK.STRENGTH_PER_TN));
}

const DAMAGE_STEPS: DamageState[] = ['OK', 'DAMAGED', 'CRIPPLED', 'DESTROYED'];
function worsen(cur: DamageState, n: number, cap: DamageState): DamageState {
  const i = DAMAGE_STEPS.indexOf(cur);
  if (i < 0) return cur; // SALVAGE/DESTROYED are terminal
  return DAMAGE_STEPS[Math.min(DAMAGE_STEPS.indexOf(cap), i + n)];
}

/**
 * Run the tactical gauntlet: `target` transitions low over `hex` (launch, landing,
 * drop pass). Emits the logged rolls, any damage, the reveals, and a GM note per hit.
 */
export function flakGauntlet(
  s: TruthState, emit: (e: GameEvent) => void,
  target: Formation, hex: GroundPos, context: string,
): void {
  const batteries = flakBatteriesNear(s, target.sideId, hex);
  for (const battery of batteries) {
    const strength = flakStrength(s, battery);
    const tn = flakTn(strength);
    const r = rollDice(s.seed, s.seedCursor, '2d6');
    emit({ type: 'DIE_ROLLED', roll: {
      id: `roll:${s.seedCursor}`, tick: s.tick,
      purpose: `flak ${battery.name} → ${target.name} (${context}, strength ${strength}, TN ${tn})`,
      dice: '2d6', result: r.result, seedCursor: r.nextCursor - 2 } });

    if (r.result >= tn) {
      const steps = strength >= FLAK.HEAVY_STRENGTH ? 2 : 1;
      // damage the first live unit — deterministic pick; tactical flak caps at CRIPPLED
      const uid = target.unitIds.find(id => {
        const u = s.units[id];
        return u && u.damage !== 'DESTROYED' && u.damage !== 'SALVAGE' && u.damage !== 'CRIPPLED';
      });
      if (uid) {
        const u = s.units[uid];
        emit({ type: 'UNIT_STATE_CHANGED', unitId: uid,
               damage: worsen(u.damage, steps, 'CRIPPLED'), ammoState: u.ammoState });
      }
      emit({ type: 'GM_NOTE', tick: s.tick,
        text: `flak: ${battery.name} hit ${target.name} on the ${context}`
          + (steps > 1 ? ' (massed battery: two steps)' : '') });
    }
    // shoot and be seen: the aircrew spot the battery — delivery follows their net status
    registerDetection(s, emit, target.sideId, battery,
      Math.min(LADDER.MAX_LEVEL, FLAK.REVEAL_LEVEL),
      { id: target.id, name: target.name, alwaysOnNet: false },
      { setLevel: true, note: 'AA battery firing position' });
  }
}

// ── D-050: anti-capital emplacements ─────────────────────────────────────────

const CAPITAL_HULLS = new Set(['DROPSHIP', 'SMALL_CRAFT', 'JUMPSHIP', 'WARSHIP']);
const FIGHTER_HULLS = new Set(['ASF', 'CONV_FIGHTER']);

function isCapitalTarget(s: TruthState, f: Formation, tracksFighters: boolean): boolean {
  return f.unitIds.some(uid => {
    const u = s.units[uid];
    if (!u || u.damage === 'DESTROYED' || u.damage === 'SALVAGE') return false;
    return CAPITAL_HULLS.has(u.class) || (tracksFighters && FIGHTER_HULLS.has(u.class));
  });
}

/** A battery whose hex an enemy ground formation holds is off the guns. */
function suppressed(s: TruthState, fac: Facility): boolean {
  if (fac.pos.kind !== 'ground') return true;
  const at = fac.pos;
  return Object.values(s.formations).some(o =>
    !o.destroyed && !o.mounted && o.sideId !== fac.sideId && o.pos.kind === 'ground' &&
    o.pos.theaterId === at.theaterId && o.pos.q === at.q && o.pos.r === at.r);
}

/** D-050.1: which range band (0=short…3=extreme) a shot at `d` air hexes uses. */
export function capitalBand(weapon: { bands: number[] }, d: number): number | null {
  for (let i = 0; i < weapon.bands.length; i++) {
    if (d <= weapon.bands[i]) return i;
  }
  return null; // beyond the weapon's printed maximum
}

/** Live enemy capital batteries whose umbrella covers the sky over `airHex`. */
export function capitalBatteriesNear(
  s: TruthState, targetSideId: string, airHex: { q: number; r: number },
): Facility[] {
  return Object.values(s.facilities)
    .filter(fac => {
      if (fac.sideId === targetSideId || !fac.capitalBattery || fac.pos.kind !== 'ground') return false;
      const w = CAPITAL_WEAPONS[fac.capitalBattery.weapon];
      if (!w) return false;
      if (!w.energy && fac.capitalBattery.shots <= 0) return false; // magazine dry
      if (suppressed(s, fac)) return false;
      return capitalBand(w, hexDistance(airHexOver(s, fac.pos), airHex)) !== null;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * One engagement: every enemy capital battery covering the sky over `airHex`
 * takes its shot at `target` (if the target is something its weapon can track).
 * Capital hits use the weapon's REAL damage steps and can destroy outright; a
 * dead ship takes everyone riding in its bays with it.
 */
export function capitalGauntlet(
  s: TruthState, emit: (e: GameEvent) => void,
  target: Formation, airHex: { q: number; r: number }, context: string,
): void {
  const batteries = capitalBatteriesNear(s, target.sideId, airHex);
  const BAND_NAMES = ['short', 'medium', 'long', 'extreme'];
  for (const fac of batteries) {
    const w = CAPITAL_WEAPONS[fac.capitalBattery!.weapon];
    if (!isCapitalTarget(s, target, w.tracksFighters)) continue;
    const d = fac.pos.kind === 'ground'
      ? hexDistance(airHexOver(s, fac.pos), airHex) : Infinity;
    const band = capitalBand(w, d);
    if (band === null) continue;
    const tn = CAPITAL_TN_BY_BAND[band];

    const r = rollDice(s.seed, s.seedCursor, '2d6');
    emit({ type: 'DIE_ROLLED', roll: {
      id: `roll:${s.seedCursor}`, tick: s.tick,
      purpose: `capital battery ${fac.name} [${fac.capitalBattery!.weapon}] → ${target.name} `
        + `(${context}, ${BAND_NAMES[band]} range ${d}, TN ${tn})`,
      dice: '2d6', result: r.result, seedCursor: r.nextCursor - 2 } });
    if (!w.energy) {
      emit({ type: 'CAPITAL_BATTERY_FIRED', facilityId: fac.id,
             shotsLeft: fac.capitalBattery!.shots - 1, tick: s.tick });
    }
    // shoot and be seen (D-051.1): a capital launch plume is unmissable — the target's
    // crew logs the site, and the knowledge reaches their side when THEY reach the net
    spotFacility(s, emit, target.sideId, fac,
      { id: target.id, name: target.name, alwaysOnNet: false });

    if (r.result >= tn) {
      const uid = target.unitIds.find(id => {
        const u = s.units[id];
        return u && u.damage !== 'DESTROYED' && u.damage !== 'SALVAGE';
      });
      if (uid) {
        const u = s.units[uid];
        const after = worsen(u.damage, w.steps, 'DESTROYED');
        emit({ type: 'UNIT_STATE_CHANGED', unitId: uid, damage: after, ammoState: u.ammoState });
        emit({ type: 'GM_NOTE', tick: s.tick,
          text: `capital battery: ${fac.name} [${fac.capitalBattery!.weapon}] hit `
            + `${target.name} on the ${context} (${w.steps} step${w.steps > 1 ? 's' : ''})` });
      }
      // a ship with nothing left flying is gone — and so is everyone in its bays
      const allDead = target.unitIds.every(id => {
        const u = s.units[id];
        return !u || u.damage === 'DESTROYED' || u.damage === 'SALVAGE';
      });
      if (allDead && !target.destroyed) {
        emit({ type: 'FORMATION_DESTROYED', formationId: target.id,
               reason: `shot down by ${fac.name}`, tick: s.tick });
        for (const rider of Object.values(s.formations)) {
          if (!rider.destroyed && rider.mounted?.carrierFormationId === target.id) {
            emit({ type: 'FORMATION_DESTROYED', formationId: rider.id,
                   reason: `lost with ${target.name}`, tick: s.tick });
          }
        }
      }
    }
  }
}

/**
 * The denial umbrella (D-050): every step, each capital battery gets one shot at
 * every enemy capital hull FLYING inside its range. Crossing a battery's sky is
 * running a SAM zone — the counterplay is ammo depletion, standoff routing, or
 * taking the battery's ground.
 */
export function capitalDenialPass(s: TruthState, emit: (e: GameEvent) => void): void {
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.pos.kind !== 'air') continue;
    capitalGauntlet(s, emit, f, { q: f.pos.gridQ, r: f.pos.gridR }, 'overflight');
  }
}
