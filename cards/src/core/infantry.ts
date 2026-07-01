/**
 * Conventional Infantry conversion: `InfantryUnit` -> `InfantryCard`.
 *
 * PURE module. A platoon's facts (troopers, movement, anti-'Mech, armament) map
 * straight across; towed FIELD GUNS are standard 'Mech-scale weapons and are
 * converted by the shared weapon engine (real damage/range/heat).
 *
 * Small-arms PLATOON damage = (sum of each carrier's per-trooper TW damage) / 3,
 * round up, then split into 2-point clusters (4 -> 2,2; 7 -> 2,2,2,1). The
 * per-trooper values (and the weapon's max range in hexes) live in
 * INFANTRY_WEAPON_DAMAGE; weapons not yet in that table leave the damage and
 * range unscored (empty).
 *
 * Damage DEGRADES as whole SQUADS are eliminated: `damageBySquads` recomputes the
 * clusters at every surviving-squad count (the card's "bodies remaining" marker,
 * grouped by squad), and `damageBreaks` compresses that into bands. RANGE is the
 * primary weapon's TW hex range mapped to Override PB/S/M/L brackets (each band
 * +2, weapon range = highest reachable band; VERIFIED vs DFA Laser Rifle card).
 *
 * Movement/TMM mirror the 'Mech rules as a best-effort starting point.
 */

import { INFANTRY_WEAPON_DAMAGE, TMM_JUMP_BONUS, WEAPON_DAMAGE_DIVISOR } from "./constants.js";
import {
  abbreviatedTicLabel,
  convertWeapon,
  formatBracket,
  groupIntoTics,
  lookupTmm,
  roundUp,
  ticHeat,
} from "./convert.js";
import type {
  CardWeapon,
  InfantryCard,
  InfantryDamageBreak,
  InfantryUnit,
  RangeBrackets,
  VehicleWeaponRow,
  Weapon,
} from "./types.js";

/**
 * Motion type -> display label + ground ("walk") MP + optional jump MP. The card
 * prints Move as `walk/run` (run = ceil(walk x 1.5)); TMM is run-based with a +1
 * sprint step (see convertInfantry). Jump infantry KEEP the normal ground
 * walk/sprint AND add a jump option (jump TMM = ground base + 2).
 *
 * VERIFIED vs DFA card: Motorized 3/5 TMM 1/2; Hover 5/8; Wheeled 4/6; Jump
 * infantry jump 3 at TMM 2 while still walking 1/2 at TMM 0/1.
 */
interface MotionSpec {
  label: string;
  move: number;
  jump?: number;
}
const MOTION: Readonly<Record<string, MotionSpec>> = {
  leg: { label: "Foot", move: 1 },
  foot: { label: "Foot", move: 1 },
  jump: { label: "Jump", move: 1, jump: 3 }, // VERIFIED: walk 1/2, jump 3 (TMM 2)
  motorized: { label: "Motorized", move: 3 }, // VERIFIED: Move 3/5, TMM 1/2
  mechanized: { label: "Mechanized", move: 2 },
  wheeled: { label: "Wheeled", move: 4 }, // VERIFIED: Move 4/6
  tracked: { label: "Tracked", move: 3 },
  hover: { label: "Hover", move: 5 }, // VERIFIED: Move 5/8
  vtol: { label: "VTOL", move: 6 },
  submarine: { label: "Submarine", move: 2 },
  "motorized scuba": { label: "SCUBA", move: 2 },
};

/** Resolve a (possibly "Beast:Horse" / "Leg") motion type to a display + move. */
function motionSpec(raw: string): MotionSpec {
  const lower = raw.toLowerCase();
  if (lower.startsWith("beast")) return { label: "Beast", move: 2 };
  return MOTION[lower] ?? { label: raw, move: 1 };
}

/**
 * Clean an infantry weapon name for display: drop a leading "Infantry" maker
 * prefix and split runtogether camelCase ("InfantrySunbeamStarfire" -> "Sunbeam
 * Starfire"); pass through hyphenated names ("Auto-Rifle") unchanged.
 */
export function cleanInfantryWeapon(raw: string): string {
  let s = raw.trim().replace(/^infantry/i, "");
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Canonical key for an infantry small arm, for the per-trooper damage table:
 * drop a leading "Infantry" maker prefix, split camelCase, and reduce every
 * non-alphanumeric run (hyphens, parens, commas) to a single space. Parenthetical
 * qualifiers are KEPT as words so variants stay distinct (Portable vs Support).
 *   "Auto-Rifle" / "Auto Rifle"     -> "auto rifle"
 *   "InfantryAssaultRifle"          -> "assault rifle"
 *   "Machine Gun (Portable)"        -> "machine gun portable"
 *   "SRM Launcher (Hvy, One-Shot)"  -> "srm launcher hvy one shot"
 */
export function infantryWeaponKey(raw: string): string {
  let s = raw.trim().replace(/^infantry/i, "");
  s = s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2");
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Split a damage total into 2-point clusters, with a trailing 1 when odd:
 * 4 -> [2,2], 7 -> [2,2,2,1], 1 -> [1], 0 -> []. How the card prints platoon damage.
 */
export function clusterDamageInto2s(total: number): number[] {
  const clusters: number[] = [];
  let remaining = Math.max(0, total);
  while (remaining >= 2) {
    clusters.push(2);
    remaining -= 2;
  }
  if (remaining > 0) clusters.push(remaining);
  return clusters;
}

/** Per-trooper TW damage + max range (hexes) for a small arm, or undefined when unscored. */
function lookupSmallArm(name: string | undefined): { damage: number; range: number } | undefined {
  if (!name) return undefined;
  return INFANTRY_WEAPON_DAMAGE[infantryWeaponKey(name)];
}

/**
 * Small-arms damage with `squads` squads still standing, as 2-point clusters.
 * Each surviving squad contributes its squadSize primary carriers plus its
 * secondaryPerSquad secondary carriers; the summed TW damage is divided by 3
 * (round up) before clustering. The official system recalculates damage as whole
 * squads are eliminated, so this is the per-squad step.
 */
function squadDamageAt(unit: InfantryUnit, squads: number, primaryDmg: number, secondaryDmg: number | undefined): number[] {
  const troopers = squads * unit.squadSize;
  let totalTw = Math.floor(troopers * primaryDmg);
  if (secondaryDmg !== undefined) {
    totalTw += Math.floor(squads * unit.secondaryPerSquad * secondaryDmg);
  }
  return clusterDamageInto2s(roundUp(totalTw / WEAPON_DAMAGE_DIVISOR));
}

/**
 * Per-squad damage-degradation track: index i = platoon damage with (i+1) squads
 * surviving, so the last entry is full strength. Empty when the primary weapon
 * is unscored.
 */
function platoonDamageTrack(unit: InfantryUnit): number[][] {
  const primary = lookupSmallArm(unit.primaryWeapon);
  if (primary === undefined || unit.squadCount <= 0) return [];
  const secondary = lookupSmallArm(unit.secondaryWeapon)?.damage;
  const track: number[][] = [];
  for (let s = 1; s <= unit.squadCount; s++) {
    track.push(squadDamageAt(unit, s, primary.damage, secondary));
  }
  return track;
}

/**
 * Compress a per-squad track into breakpoints (full strength first): runs of
 * equal damage collapse into a single {from, to, damage} band, where from/to are
 * surviving-SQUAD counts. So a 4-squad platoon that does 2·2 at 4–3 squads then
 * 2 at 2–1 prints as two rows.
 */
export function damageBreakpoints(track: number[][]): InfantryDamageBreak[] {
  const breaks: InfantryDamageBreak[] = [];
  for (let i = track.length - 1; i >= 0; i--) {
    const squads = i + 1;
    const dmg = track[i]!;
    const last = breaks[breaks.length - 1];
    if (last && arraysEqual(last.damage, dmg)) {
      last.to = squads;
    } else {
      breaks.push({ from: squads, to: squads, damage: dmg });
    }
  }
  return breaks;
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Override range brackets for an infantry small arm from its TW max range R
 * (hexes). VERIFIED vs DFA card: a Laser Rifle (R = 2) reads PB +0, S +2, M +4,
 * L –. So each range band escalates the to-hit by +2, and the weapon's hex range
 * is the highest band it can reach (PB = 0, S = 1, M = 2, L = 3). Infantry use
 * only PB/S/M/L — there is no Extreme column. R = 0 (adjacent-only weapons like
 * flamers/grenades) yields Point-Blank only; weapons with R ≥ 3 all reach Long.
 */
export function infantryRangeBrackets(rangeHexes: number): RangeBrackets {
  const r = Math.max(0, Math.floor(rangeHexes));
  return {
    pb: 0,
    s: r >= 1 ? 2 : null,
    m: r >= 2 ? 4 : null,
    l: r >= 3 ? 6 : null,
    x: null,
  };
}

/** Convert towed field guns (standard weapons) into card weapon rows. */
function buildFieldGuns(names: ReadonlyArray<string>, techBase: InfantryUnit["techBase"]): VehicleWeaponRow[] {
  const cardWeapons: CardWeapon[] = names.map((name) => {
    const w: Weapon = { name, location: "CT", rawLocation: "Field Gun", rearMounted: false };
    return convertWeapon(w, techBase, 0);
  });
  return groupIntoTics(cardWeapons).map((tic) => ({
    label: abbreviatedTicLabel(tic, techBase),
    facing: "",
    damageText: tic.damageText,
    heat: ticHeat(tic),
    range: tic.range,
    rangeText: tic.rangeText,
    unknown: tic.weapons.some((w) => w.unknown),
  }));
}

/** Convert a parsed infantry platoon into an Infantry Override card. */
export function convertInfantry(unit: InfantryUnit): InfantryCard {
  const warnings: string[] = [];
  const motion = motionSpec(unit.motionType);
  // Move prints walk/run (run = ceil(walk x 1.5)); TMM is run-based with a +1
  // sprint step (VERIFIED: motorized 3/5 -> 1/2). Jump infantry KEEP the ground
  // walk/sprint and ALSO list a jump option (jump TMM = ground base + 2, so a
  // walk-1 jump-3 platoon reads Move "1/2 · Jump 3", TMM "0/1 · Jump 2").
  const walk = motion.move;
  const run = Math.ceil(walk * 1.5);
  const baseTmm = lookupTmm(run);
  let move = `${walk}/${run}`;
  let tmmText = `${baseTmm}/${baseTmm + 1}`;
  let tmm = baseTmm;
  if (motion.jump !== undefined) {
    // Jumping adds the +2 jump step over the base TMM, so a walk-1 (base 0)
    // jump-3 platoon evades at TMM 2 (VERIFIED vs DFA card).
    const jumpTmm = baseTmm + TMM_JUMP_BONUS;
    move += ` · Jump ${motion.jump}`;
    tmmText += ` · Jump ${jumpTmm}`;
    tmm = jumpTmm; // headline TMM (CSV) = the best evasion the platoon can get
  }

  const fieldGuns = buildFieldGuns(unit.fieldGuns, unit.techBase);
  for (const g of fieldGuns) {
    if (g.unknown) warnings.push(`field gun not in TW damage table: "${g.label}" (damage set to 0)`);
  }

  const primaryArm = lookupSmallArm(unit.primaryWeapon);
  const secondaryArm = lookupSmallArm(unit.secondaryWeapon);
  if (primaryArm === undefined) {
    warnings.push(`small-arms damage/range unscored: primary "${unit.primaryWeapon}" not in the infantry weapon table`);
  }
  const track = platoonDamageTrack(unit);
  const range = primaryArm ? infantryRangeBrackets(primaryArm.range) : null;

  return {
    kind: "infantry",
    name: `${unit.chassis} ${unit.model}`.trim(),
    chassis: unit.chassis,
    model: unit.model,
    techBase: unit.techBase,
    troopers: unit.troopers,
    motionLabel: motion.label,
    move,
    tmm,
    tmmText,
    antiMek: unit.antiMek,
    squadSize: unit.squadSize,
    squadCount: unit.squadCount,
    damage: track.length ? track[track.length - 1]! : [],
    damageBySquads: track,
    damageBreaks: damageBreakpoints(track),
    range,
    // Infantry use only PB/S/M/L (no Extreme column) — match the DFA card.
    rangeText: range ? [range.pb, range.s, range.m, range.l].map(formatBracket).join(" ") : null,
    primaryRangeHexes: primaryArm ? primaryArm.range : null,
    ...(secondaryArm ? { secondaryRangeHexes: secondaryArm.range } : {}),
    primaryWeapon: cleanInfantryWeapon(unit.primaryWeapon),
    ...(unit.secondaryWeapon ? { secondaryWeapon: cleanInfantryWeapon(unit.secondaryWeapon) } : {}),
    secondaryCount: unit.secondaryPerSquad * unit.squadCount,
    fieldGuns,
    warnings,
    sourceFile: unit.sourceFile,
  };
}
