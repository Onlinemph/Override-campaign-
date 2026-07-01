/**
 * roster/roll.ts — build armies from the bundled card library: roll a random force to
 * a spec, or convert a card-builder force file into campaign unit specs. Impure (reads
 * the library via roster/library); seeded so a roll is reproducible.
 */
import type { UnitClass } from '../core/types.js';
import { deriveFieldsForModel, libraryIndex } from './library.js';

export type WeightClass = 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'ASSAULT';

/** BattleMech weight class from tonnage (20–35 L, 40–55 M, 60–75 H, 80+ A). */
export function weightClass(tonnage: number): WeightClass {
  if (tonnage >= 80) return 'ASSAULT';
  if (tonnage >= 60) return 'HEAVY';
  if (tonnage >= 40) return 'MEDIUM';
  return 'LIGHT';
}

/** A rolled unit: enough to author a campaign formation (stats derive on load). */
export interface RolledUnit { model: string; class: UnitClass; bv?: number; tonnage?: number }

export interface RollSpec {
  count: number;
  seed?: string;
  classes?: UnitClass[];      // restrict to these campaign classes
  era?: string;               // substring match on the library era folder
  weight?: WeightClass;       // BattleMech weight band
  minBv?: number;
  maxBv?: number;
}

// index category → the campaign classes it can yield (coarse pre-filter, avoids parsing)
const CATEGORY_CLASSES: Record<string, UnitClass[]> = {
  mechs: ['MECH'],
  vehicles: ['VEHICLE', 'VTOL', 'NAVAL'],
  aerospace: ['ASF', 'CONV_FIGHTER'],
  battlearmor: ['BA'],
  infantry: ['INFANTRY'],
  protomechs: ['PROTO'],
  dropships: ['DROPSHIP'],
};

function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roll a random force from the library to the given spec. Returns [] with no library. */
export function rollForce(spec: RollSpec): RolledUnit[] {
  const index = libraryIndex();
  if (!index) return [];
  const rng = mulberry32(strHash(`${spec.seed ?? 'ROLL'}:${spec.count}`));
  const wantClasses = spec.classes && spec.classes.length ? new Set(spec.classes) : null;
  const era = spec.era?.trim().toLowerCase();

  // cheap pre-filter on the index (category + era) — no parsing yet
  const candidates = index.filter(e => {
    const cats = CATEGORY_CLASSES[(e.category ?? '').toLowerCase()] ?? ['MECH'];
    if (wantClasses && !cats.some(c => wantClasses.has(c))) return false;
    if (era && !`${e.era ?? ''}`.toLowerCase().includes(era)) return false;
    return true;
  });

  // seeded Fisher–Yates shuffle
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }

  const out: RolledUnit[] = [];
  for (const e of candidates) {
    if (out.length >= spec.count) break;
    const d = deriveFieldsForModel(e.name);
    if (!d) continue;
    if (wantClasses && !wantClasses.has(d.class)) continue;                 // exact class
    if (spec.minBv !== undefined && (d.bv ?? 0) < spec.minBv) continue;
    if (spec.maxBv !== undefined && (d.bv ?? Infinity) > spec.maxBv) continue;
    if (spec.weight && (d.tonnage === undefined || weightClass(d.tonnage) !== spec.weight)) continue;
    out.push({ model: e.name, class: d.class, ...(d.bv != null ? { bv: d.bv } : {}), ...(d.tonnage != null ? { tonnage: d.tonnage } : {}) });
  }
  return out;
}

/** One unit as it appears in a card-builder force export (`{name, units:[...]}`). */
interface CardForceUnit { name?: string; file?: string; gunnery?: number; piloting?: number }

/** A campaign unit spec authored from a rolled/imported unit. */
export interface CampaignUnitSpec {
  name: string; model: string; class: UnitClass; tags: string[];
  gunnery?: number; piloting?: number;
}

/**
 * Convert a card-builder force export into campaign unit specs, resolving each unit's
 * class from the library (by name, then filename). Units that don't resolve default to
 * MECH so the GM can fix the class in the editor.
 */
export function campaignUnitsFromForce(force: { units?: CardForceUnit[] } | null | undefined): CampaignUnitSpec[] {
  const units = force?.units ?? [];
  const out: CampaignUnitSpec[] = [];
  for (const u of units) {
    const stem = (u.file ?? '').replace(/\\/g, '/').split('/').pop()?.replace(/\.(mtf|blk)$/i, '');
    const model = u.name || stem || 'Unknown';
    const d = deriveFieldsForModel(model) ?? (stem ? deriveFieldsForModel(stem) : null);
    out.push({
      name: model, model, class: d?.class ?? 'MECH', tags: [],
      ...(u.gunnery !== undefined ? { gunnery: u.gunnery } : {}),
      ...(u.piloting !== undefined ? { piloting: u.piloting } : {}),
    });
  }
  return out;
}
