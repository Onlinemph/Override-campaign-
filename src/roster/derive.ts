/**
 * roster/derive.ts — derive campaign Unit fields from a parsed card builder record
 * sheet, so movement, class, and electronic-warfare gear come straight off the
 * real .mtf/.blk instead of being hand-authored. PURE: takes an already-parsed
 * card (+ raw text for the equipment scan) and returns plain fields. The fs +
 * parse glue lives in roster/library.ts; the enrichment policy in roster/enrich.ts.
 *
 * These fields are exactly what the existing engines already read: movement feeds
 * op-map pace (deriveFormationOmp), safe/max thrust feed air/space, and the tags
 * feed detection (ECM signature, probe/HQ sensor range, class) and the command net.
 */
import type { FuelLedger, UnitClass } from '../core/types.js';

/** The slice of a card builder AnyCard we read; fields are optional/defensive. */
export interface ParsedCardLike {
  kind: 'mech' | 'battlearmor' | 'vehicle' | 'fighter' | 'infantry' | 'protomech' | 'dropship';
  card: {
    mass?: number; // 'Mech card tonnage
    tonnage?: number; // vehicle / fighter / dropship / proto tonnage
    walkMove?: number; // 'Mech card
    runMove?: number;
    walkMP?: number; // BA card
    jumpMP?: number;
    jump?: number; // 'Mech / vehicle jump MP
    cruiseMP?: number;
    flankMP?: number;
    motionType?: string;
    conventional?: boolean;
    safeThrust?: number;
    maxThrust?: number;
    fuel?: number;
    move?: string; // proto / infantry printed move string
  };
}

/** Fields we can derive from the record sheet (all optional at the seams). */
export interface DerivedUnitFields {
  class: UnitClass;
  walkOrCruise: number;
  run: number;
  jump: number;
  safeThrust?: number;
  maxThrust?: number;
  fuel?: FuelLedger;
  bv?: number;
  tonnage?: number;
  tags: string[];
  /** D-050: flak battery strength from the sheet's real guns (AA-quirked units). */
  flak?: number;
}

/**
 * D-050: grade an AA unit's flak strength from the weapons actually on its card.
 * The premier flak systems (LB-X cluster, rotary ACs, HAGs) count double; standard
 * autocannons count once; a unit with the AA quirk but no flak-class guns is still
 * a battery of 1 (LRM/laser air-defense fits). Capped so one hull can't be an army.
 */
export function flakStrengthFromWeapons(parsed: ParsedCardLike): number {
  const list = ((parsed.card as { weapons?: unknown[] }).weapons ?? []) as Array<
    { label?: string; name?: string }>;
  let heavy = 0, guns = 0;
  for (const w of list) {
    const label = String(w.label ?? w.name ?? '');
    const mult = label.match(/^x(\d+)\b/i);
    const count = mult ? Number(mult[1]) : 1;
    const n = label.toLowerCase();
    if (/lb[\s-]?\d+[\s-]?x|rotary|\brac[\s/]?\d|hag[\s/]?\d|hyper[\s-]?assault/.test(n)) {
      heavy += count;
    } else if (/auto\s?cannon|\bac[\s/]?\d|\buac[\s/]?\d/.test(n)) {
      guns += count;
    }
  }
  return Math.min(6, 1 + heavy * 2 + guns);
}

/** Pull the first up-to-3 integers out of a printed move string ("5 / 8 / 5j"). */
function parseMoveNumbers(s: string | undefined): number[] {
  if (!s) return [];
  return (s.match(/\d+/g) ?? []).slice(0, 3).map(Number);
}

function vehicleClass(motionType: string | undefined): UnitClass {
  const m = (motionType ?? '').toLowerCase();
  if (m.includes('vtol')) return 'VTOL';
  if (m.includes('naval') || m.includes('submarine') || m.includes('hydrofoil')) return 'NAVAL';
  return 'VEHICLE';
}

/**
 * Electronic-warfare / equipment tags scanned from the raw record-sheet text.
 * Kind-agnostic (equipment names are the same across .mtf/.blk). Angel ECM is
 * checked before generic ECM so it isn't double-counted. Watchdog / Nova CEWS
 * are combined ECM+probe suites, so they yield both tags.
 */
export function extractTags(text: string, motionType?: string): string[] {
  const t = text;
  const tags = new Set<string>();

  const has = (re: RegExp) => re.test(t);
  const angel = has(/angel\s*ecm/i);
  const combo = has(/watchdog|nova\s*cews/i); // ECM + probe in one suite
  if (angel) tags.add('ANGEL_ECM');
  else if (combo || has(/guardian\s*ecm|\b(?:is|cl)?ecm\b|ecm\s*suite/i)) tags.add('ECM');

  if (combo || has(/beagle|active\s*probe|bloodhound/i)) tags.add('BEAGLE');
  if (has(/\bstealth\b/i)) tags.add('STEALTH');
  if (has(/c3\s*master|c3master/i)) tags.add('C3M');
  if (has(/mobile\s*(hq|headquarters)|command\s*console/i)) tags.add('HQ');

  // artillery pieces (D-045): these tags are what gives a battery its range —
  // firesPass/batteryRange read them (ARTILLERY_TAG_RANGE). Matched against the
  // weapon names as printed on the sheet, so "Beast Infantry (Sniper)" riflemen
  // don't become an artillery battalion.
  if (has(/long\s*tom/i)) tags.add('LONG_TOM');
  if (has(/sniper\s*(artillery|cannon)/i)) tags.add('SNIPER');
  if (has(/thumper\s*(artillery|cannon)/i)) tags.add('THUMPER');
  if (has(/arrow\s*iv/i)) tags.add('ARROW_IV');

  if ((motionType ?? '').toLowerCase().includes('wheeled')) tags.add('WHEELED');
  if (/hover|wige/.test((motionType ?? '').toLowerCase())) tags.add('HOVER');

  // hull shape (DropShips/small craft): the flying egg vs the lifting body — spheroids
  // crawl in atmosphere (SKYWATCH SPHEROID_ATMO_HEX_PER_TICK); the fast lane is orbit
  const motion = (motionType ?? '').toLowerCase();
  if (motion.includes('spheroid') || /<motion_type>\s*spheroid/i.test(t)) tags.add('SPHEROID');
  else if (motion.includes('aerodyne') || /<motion_type>\s*aerodyne/i.test(t)) tags.add('AERODYNE');
  return [...tags];
}

/**
 * Derive campaign Unit fields from a parsed card (+ its raw text and optional BV).
 * Returns sane defaults for the exotic move layouts; the enrich policy decides
 * whether these overwrite anything.
 */
export function deriveUnitFields(
  parsed: ParsedCardLike, text: string, bv?: number, role?: string, quirks?: string[],
): DerivedUnitFields {
  const c = parsed.card;
  const tags = extractTags(text, c.motionType);
  // MUL battlefield role → campaign mission tag. Only "Scout" maps cleanly to an
  // engine effect (RECON extends a VTOL's sensor range); other roles are advisory.
  if (role && /scout/i.test(role) && !tags.includes('RECON')) tags.push('RECON');
  // D-050: the Anti-Aircraft Targeting quirk is the canonical mark of a real AA
  // unit (the whole Partisan family carries it) — no more hand-taped tags
  if (quirks?.some(q => /anti[\s-]?aircraft/i.test(q)) && !tags.includes('AA')) tags.push('AA');
  const tonnage = c.mass ?? c.tonnage;
  // D-050: a battery's punch comes from its actual guns
  const flak = tags.includes('AA') ? flakStrengthFromWeapons(parsed) : undefined;
  const base = { bv, tags, ...(tonnage !== undefined ? { tonnage } : {}),
                 ...(flak !== undefined ? { flak } : {}) };

  switch (parsed.kind) {
    case 'mech': {
      return {
        class: 'MECH',
        walkOrCruise: c.walkMove ?? 0, run: c.runMove ?? 0, jump: c.jump ?? 0, ...base,
      };
    }
    case 'vehicle': {
      return {
        class: vehicleClass(c.motionType),
        walkOrCruise: c.cruiseMP ?? 0, run: c.flankMP ?? 0, jump: 0, ...base,
      };
    }
    case 'battlearmor': {
      const walk = c.walkMP ?? 0;
      return { class: 'BA', walkOrCruise: walk, run: walk, jump: c.jumpMP ?? 0, ...base };
    }
    case 'protomech': {
      const [w = 0, r = w, j = 0] = parseMoveNumbers(c.move);
      return { class: 'PROTO', walkOrCruise: w, run: r, jump: j, ...base };
    }
    case 'infantry': {
      const nums = parseMoveNumbers(c.move);
      const jumpish = /\bj\b|\(j\)|jump/i.test(c.move ?? '');
      const walk = nums[0] ?? 1;
      return {
        class: 'INFANTRY',
        walkOrCruise: walk, run: nums[1] ?? walk, jump: jumpish ? (nums[0] ?? 0) : 0, ...base,
      };
    }
    case 'fighter': {
      const safe = c.safeThrust ?? 0;
      const max = c.maxThrust ?? 0;
      const conv = !!c.conventional;
      const fuel: FuelLedger | undefined = c.fuel != null
        ? { fp: c.fuel, fpPerTon: conv ? 160 : 80, tons: c.fuel / (conv ? 160 : 80) }
        : undefined;
      return {
        class: conv ? 'CONV_FIGHTER' : 'ASF',
        walkOrCruise: safe, run: max, jump: 0, safeThrust: safe, maxThrust: max,
        ...(fuel ? { fuel } : {}), ...base,
      };
    }
    case 'dropship': {
      const safe = c.safeThrust ?? 0;
      const max = c.maxThrust ?? 0;
      return {
        class: 'DROPSHIP', walkOrCruise: safe, run: max, jump: 0,
        safeThrust: safe, maxThrust: max, ...base,
      };
    }
  }
}
