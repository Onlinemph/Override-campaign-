/**
 * engine/sensors.ts — the derived sensor suite (core §3 SNS: "best sensor suite").
 *
 * D-059: this lived in detection.ts, but the terrain-scouting pass in net.ts needs
 * it too, and detection.ts already imports from net.ts — a shared leaf module keeps
 * the dependency graph acyclic. Everything that answers "how far can this formation
 * sense?" must go through here; reading the raw authored `f.sns` misses the gear
 * (Beagle probes, Mobile HQs, recon VTOLs) that derivation puts on the units.
 */
import { SENSOR_RANGES } from '../rules.js';
import type { Formation, TruthState } from '../core/types.js';

export function formationSensors(
  s: TruthState, f: Formation,
): { passive: number; active: number } {
  let best: { passive: number; active: number } = { ...SENSOR_RANGES.MECH_STANDARD };
  for (const uid of f.unitIds) {
    const u = s.units[uid];
    if (!u) continue;
    const candidates: Array<{ passive: number; active: number }> = [];
    if (u.tags.includes('BEAGLE')) candidates.push(SENSOR_RANGES.BEAGLE);
    if (u.tags.includes('HQ')) candidates.push(SENSOR_RANGES.MOBILE_HQ);
    if (u.tags.includes('RECON') && u.class === 'VTOL') candidates.push(SENSOR_RANGES.RECON_VTOL);
    for (const c of candidates) if (c.passive > best.passive) best = { ...c };
  }
  // formation may carry explicit sns overrides from setup
  if (f.sns.passive > best.passive || f.sns.active > best.active) {
    best = { passive: Math.max(f.sns.passive, best.passive), active: Math.max(f.sns.active, best.active) };
  }
  return best;
}
