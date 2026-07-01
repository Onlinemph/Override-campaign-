/**
 * Conversion math: typed `Unit` -> `OverrideCard`.
 *
 * PURE module: no Node/browser/filesystem imports. Fully decoupled from the
 * parser — it consumes a `Unit` and knows nothing about MTF text. Every formula
 * is sourced from constants.ts; the only literals here are structural (0, the
 * mins already named in constants).
 *
 * v1 SCOPE: one weapon per TIC. The following are intentionally left as clearly
 * marked TODO hooks and are NOT implemented:
 *   - TIC grouping (summing several weapons into one TIC before dividing by 3)
 *   - page-43 range-bracket modifiers
 *   - M/C dice
 */

import {
  ARM_LEG_ARMOR_DIVISOR,
  HEAD_ARMOR_LOOKUP,
  HEAT_DISSIPATION_DIVISOR,
  HEAT_GENERATING_EQUIPMENT,
  HEAT_PER_DOUBLE_SINK,
  CLUSTER_WEAPON_FAMILIES,
  HEAT_PER_SINGLE_SINK,
  IMPORTANT_EQUIPMENT,
  KICK_TW_DIVISOR,
  LOCATION_ORDER,
  M_DICE_DIVISOR,
  MELEE_WEAPONS,
  MIN_ARM_LEG_ARMOR,
  MIN_STRUCTURE,
  MISSILE_WEAPON_FAMILIES,
  PUNCH_TW_DIVISOR,
  RANGE_VARYING_CLUSTER_FAMILIES,
  REAR_ARMOR_DIVISOR,
  SPECIAL_ARMOR,
  SPECIAL_COCKPIT,
  SPECIAL_ENGINE,
  SPECIAL_GYRO,
  STRUCTURE_DIVISOR,
  CAPITAL_SCALE_DIVISOR,
  TIC_MAX_BASE,
  TIC_MAX_DAMAGE,
  WEAPON_BRACKET_OVERRIDE,
  WEAPON_HEAT_DAMAGE,
  WEAPON_SPECIAL_DAMAGE,
  WEAPON_DAMAGE_BY_RANGE,
  WEAPON_RANGES,
  WEAPON_RANGES_CLAN,
  TMM_BY_RUN,
  TMM_JUMP_BONUS,
  TMM_SPRINT_BONUS,
  TORSO_ARMOR_DIVISOR,
  TORSO_STRUCTURE_BY_TONNAGE,
  WEAPON_ABBREV,
  WEAPON_DAMAGE,
  RUN_MP_MULTIPLIER,
  WEAPON_DAMAGE_CLAN,
  WEAPON_DAMAGE_DIVISOR,
  WEAPON_HEAT,
  WEAPON_HINTS,
  WEAPON_RV_MISSILE,
} from "./constants.js";
import type {
  CardEquipment,
  CardWeapon,
  CritSlot,
  DamageKind,
  DamageProfile,
  OverrideCard,
  RangeBrackets,
  TechBase,
  Tic,
  Unit,
  VehicleWeaponRow,
  Weapon,
  WeaponRange,
} from "./types.js";

// ---------------------------------------------------------------------------
// Rounding helpers — explicit and used per field. Damage rounds UP;
// armor/structure/heat round to NEAREST. Never use one mode everywhere.
// ---------------------------------------------------------------------------

/** Round toward +Infinity. Used for weapon damage. */
export function roundUp(n: number): number {
  return Math.ceil(n);
}

/** Round to the nearest integer (.5 rounds up). Used for armor/structure/heat. */
export function roundNearest(n: number): number {
  return Math.round(n);
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Head armor: first bracket whose maxTw >= the head's TW armor. */
export function lookupHeadArmor(headTw: number): number {
  for (const bracket of HEAD_ARMOR_LOOKUP) {
    if (headTw <= bracket.maxTw) return bracket.armor;
  }
  // HEAD_ARMOR_LOOKUP ends at Infinity, so this is unreachable.
  return HEAD_ARMOR_LOOKUP[HEAD_ARMOR_LOOKUP.length - 1]!.armor;
}

/** Base TMM: first bracket whose maxRun >= runMP. Keyed on RUN MP. */
export function lookupTmm(runMP: number): number {
  for (const bracket of TMM_BY_RUN) {
    if (runMP <= bracket.maxRun) return bracket.tmm;
  }
  return TMM_BY_RUN[TMM_BY_RUN.length - 1]!.tmm;
}

/**
 * Normalize an MTF/BLK weapon name to a WEAPON_DAMAGE key.
 *
 * Handles the common spelling variants:
 *   - leading ammo/count prefix ("1 Medium Laser")
 *   - attached tech prefix ("ISMediumLaser", "CLERLargeLaser")
 *   - attached BA prefix ("CLBAERSmallLaser" -> "er small laser")
 *   - spaced tech/BA prefix ("IS Medium Laser", "Clan ER PPC", "BA ER Small Laser")
 *   - "[BA]" suffix ("Flamer [BA]" -> "flamer")
 *   - camelCase / letter-digit run-together ("ISAC20" -> "ac/20")
 *   - "Autocannon/N" -> "ac/N", "AC N" -> "ac/N"
 *   - "LRM-15"/"SRM-6" -> "lrm 15"/"srm 6"
 *   - MG abbreviation ("heavy mg" -> "heavy machine gun")
 *   - trailing OS suffix ("advanced srm 2 os" -> "advanced srm 2")
 */
/**
 * Map a capital / naval / sub-capital weapon name to a stable key. These carry
 * their discriminator INSIDE a parenthetical ("Naval Autocannon (NAC/10)",
 * "Capital Missile Launcher (Killer Whale)") that the generic qualifier-strip in
 * normalizeWeaponName would discard — so they are resolved first, with an early
 * return that skips the camelCase/digit splitting (which would mangle "nac/10").
 * Tele-operated "-T" variants collapse to their base warhead (identical stats).
 */
function capitalWeaponKey(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/naval autocannon\s*\(nac\/(\d+)\)/)) || (m = s.match(/^nac[\s/-]?(\d+)/)))
    return `nac/${m[1]}`;
  if ((m = s.match(/naval gauss\s*\((light|medium|heavy)\)/))) return `naval gauss ${m[1]}`;
  if ((m = s.match(/naval laser\s*(\d+)/))) return `naval laser ${m[1]}`;
  if ((m = s.match(/naval ppc\s*\((light|medium|heavy)\)/))) return `naval ppc ${m[1]}`;
  if ((m = s.match(/mass driver\s*\((light|medium|heavy)\)/))) return `mass driver ${m[1]}`;
  if (/screen launcher/.test(s)) return "screen launcher";
  if ((m = s.match(/sub-?capital cannon\s*\((light|medium|heavy)\)/))) return `sub-capital cannon ${m[1]}`;
  if ((m = s.match(/sub-?capital laser\s*\/?\s*(\d)/))) return `sub-capital laser ${m[1]}`;
  // Capital & sub-capital missiles: the warhead name lives in the parenthetical.
  if (
    (m = s.match(/(?:sub-?)?capital missile launcher\s*\(([^)]+?)(?: launcher)?\)/)) ||
    (m = s.match(/tele-?operated missile\s*\(([^)]+?)\)/))
  )
    return m[1]!.replace(/[\s-]?t$/, "").trim(); // strip the tele "-T" suffix to the base warhead
  return null;
}

export function normalizeWeaponName(raw: string): string {
  const cap = capitalWeaponKey(raw);
  if (cap) return cap;
  let s = raw.trim();
  s = s.replace(/:[A-Za-z0-9]+$/, ""); // drop a trailing mount/omni tag ("...:OMNI", "...:LA")
  s = s.replace(/\s*\([^)]*\)/g, ""); // drop qualifiers like "(OS)", "(I-OS)", "(Clan)"
  s = s.replace(/\s*\[ba\]/gi, ""); // drop "[BA]" suffix ("Flamer [BA]" -> "Flamer")
  s = s.replace(/^\d+\s+/, ""); // drop leading count
  s = s.replace(/^(IS|CL)(?=[A-Z])/, ""); // drop attached tech prefix ("ISMediumLaser" -> "MediumLaser")
  s = s.replace(/^(IS|CL)(?=i[A-Z])/, ""); // tech prefix glued before the improved-marker "i" ("CLiATM12" -> "iATM12")
  s = s.replace(/^BA(?=[A-Z])/, ""); // drop attached BA prefix ("BAERSmallLaser" -> "ERSmallLaser")
  s = s.replace(/^(IS|CL)(?=[A-Z])/, ""); // re-strip a tech prefix that followed BA ("BACLERMediumPulseLaser")
  // Split an acronym run from a following Capitalized word ("ERSmall" -> "ER
  // Small"), then camelCase and letter/digit boundaries ("MediumLaser" ->
  // "Medium Laser"). The first handles BLK's glued names (e.g. "CLERSmallLaser").
  s = s.replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/(\d)([A-Za-z])/g, "$1 $2");
  s = s.toLowerCase().replace(/\s+/g, " ").trim();
  s = s.replace(/^(is|cl|clan)\s+/, ""); // drop spaced tech prefix
  s = s.replace(/^ba\s+/, ""); // drop spaced BA prefix ("ba er small laser" -> "er small laser")
  s = s.replace(/\berppc\b/g, "er ppc"); // glued all-caps "ERPPC" (from "ISERPPC"/"CLERPPC") -> "er ppc"
  s = s.replace(/\bparticle cannon\b/g, "ppc"); // "(Light/Heavy/...) Particle Cannon" -> "(...) ppc"
  s = s.replace(/\bhyper[\s-]?velocity (?:auto ?cannon|ac)\s*\/?\s*(\d+)/g, "hvac/$1"); // Hyper Velocity Auto Cannon/10 -> hvac/10
  s = s.replace(/\bautocannon\//g, "ac/"); // Autocannon/20 -> ac/20
  s = s.replace(/\bhyper assault gauss\b/g, "hag"); // Hyper Assault Gauss/30 -> hag/30
  s = s.replace(/\b(ac|hag)\s+(\d+)/g, "$1/$2"); // "ac 20"/"hag 30" -> "ac/20"/"hag/30" (also Rotary/Ultra/Light AC)
  s = s.replace(/\blb[\s-]?x[\s-]?ac[\s-]?(\d+)/g, "lb $1-x ac"); // glued "LBXAC10" -> "lb 10-x ac"
  s = s.replace(/\blight auto ?cannon\s*\/?\s*(\d+)/g, "light ac/$1"); // "Light Auto Cannon/5" -> "light ac/5"
  s = s.replace(/\blac[\s/-]?(\d+)/g, "light ac/$1"); // "LAC5"/"LAC/5" -> "light ac/5"
  // Torpedoes share their missile counterpart's stats (LRT = LRM, SRT = SRM,
  // same Clan/IS divide) — they only differ in being underwater-only.
  s = s.replace(/\blrt\b/g, "lrm").replace(/\bsrt\b/g, "srm");
  s = s.replace(/\b(srm|lrm|mml|atm|iatm)\s*-\s*(\d+)/g, "$1 $2"); // srm-6/mml-5/atm-6 -> "srm 6" etc.
  s = s.replace(/^streak\s+/, ""); // Streak weapons share their non-streak counterpart's stats

  s = s.replace(/\bx[\s-]?pulse\b/g, "xpulse"); // "X-Pulse"/"X Pulse" -> "xpulse"
  s = s.replace(/re-?engineered/g, "reengineered"); // "Re-engineered" -> "reengineered"
  s = s.replace(/^arrow ?iv\b.*/, "arrow iv"); // "Arrow IV System"/"ArrowIV" -> "arrow iv"
  s = s.replace(/^tsemp\b.*/, "tsemp cannon"); // any TSEMP variant -> "tsemp cannon"
  s = s.replace(/\bimproved atm\b/g, "atm").replace(/\bi\s*atm\b/g, "atm"); // iATM shares the ATM stat block (streak)
  s = s.replace(/\bmagshot gr\b/g, "magshot gauss rifle"); // BA "MagshotGR" -> full name
  s = s.replace(/\bmag shot\b/g, "magshot"); // "MagShot" splits to "mag shot" -> rejoin
  s = s.replace(/\bfire ?drake( incendiary)?\b/g, "firedrake"); // "FireDrake"/"Firedrake Incendiary" -> "firedrake"
  s = s.replace(/\bvibroblade\b/g, "vibro blade"); // one-word "Vibroblade" -> "vibro blade"
  s = s.replace(/\b(?:battle ?mech|mek) taser\b/g, "mech taser"); // BattleMech/Mek Taser -> mech taser
  s = s.replace(/^taser$/, "mech taser"); // bare "Taser" (incl. BA Taser) -> mech taser
  s = s.replace(/\bchemical laser\b/g, "chem laser"); // "Medium Chemical Laser" -> "medium chem laser"
  s = s.replace(/\bimproved (small|medium|large) heavy laser\b/g, "improved heavy $1 laser"); // MegaMek word order
  s = s.replace(/\bi-?os\b/g, "").trim(); // strip "(I)OS" Improved-One-Shot suffix (ISSRM2IOS -> srm 2)
  s = s.replace(/\b(rocket launcher \d+) prototype\b/g, "$1"); // prototype RL = same stats
  s = s.replace(/\bprototype (rocket launcher \d+)\b/g, "$1"); // "Prototype Rocket Launcher 20" -> "rocket launcher 20"
  s = s.replace(/\brl\s*-?\s*(\d+)/g, "rocket launcher $1"); // glued "RL10" -> "rocket launcher 10"
  s = s.replace(/\brocket launcher ([1-9])\b/g, "ba rl $1"); // single-digit RL = BA rocket launcher (1-5); mech RLs are 10/15/20
  s = s.replace(/\bmrm\s*-?\s*([1-9])\b/g, "ba mrm $1"); // single-digit MRM = BA MRM (1-5); mech MRMs are 10/20/30/40
  s = s.replace(/\blr torpedo\s*(\d+)/g, "lrm $1").replace(/\bsr torpedo\s*(\d+)/g, "srm $1"); // LR/SR Torpedo = LRM/SRM
  s = s.replace(/\s+artillery\b/g, ""); // "Thumper Artillery" -> "thumper", "Sniper Artillery" -> "sniper"
  s = s.replace(/\b(er medium laser) prototype\b/g, "prototype $1"); // glued "CLERMediumLaserPrototype" word order
  s = s.replace(/\b(ac\/\d+) primitive\b/g, "$1"); // "Autocannon/10 Primitive" -> ac/10
  s = s.replace(/\bmg\b/g, "machine gun"); // MG abbreviation -> full name
  s = s.replace(/\bl?mga\b/g, "machine gun array"); // "MGA"/"LMGA" -> Machine Gun Array
  s = s.replace(/\b([abm]) pod\b/g, "$1-pod"); // de-glued "ISMPod" -> "m pod" -> "m-pod"
  s = s.replace(/\banti personnel pod\b/g, "anti-personnel pod"); // glued "ISAntiPersonnelPod"
  s = s.replace(/\blppc\b/g, "light ppc"); // glued "ISLPPC" -> "light ppc"
  s = s.replace(/\bsbgr\b/g, "silver bullet gauss rifle"); // glued "ISSBGR" -> full name
  s = s.replace(/\bsnppc\b/g, "snub-nose ppc"); // glued "ISSNPPC" -> "snub-nose ppc"
  s = s.replace(/\b(small|medium|large) vsp\b(?!\s+laser)/g, "$1 vsp laser"); // "Medium VSP" -> "medium vsp laser"
  s = s.replace(/\bblazer cannon\b/g, "binary laser cannon"); // "Blazer Cannon" -> canonical name
  s = s.replace(/\bos\s*$/, "").trimEnd(); // trailing "os" (one-shot variant without parens)
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Compact display label for a weapon, for the Battle Armor firepower table.
 * Uses the curated WEAPON_ABBREV map (e.g. "SLas", "SRM-2") when known, else a
 * cleaned, spaced version of the original name. For Clan units, a lowercase "c"
 * prefix is added to ballistic/missile abbreviations (matching the printed
 * card's "cSRM-2"); energy abbreviations are left unprefixed.
 */
export function abbreviateWeapon(raw: string, techBase: TechBase = "IS"): string {
  // normalizeWeaponName strips "Streak" (it shares the base weapon's stats), but
  // the label should keep it — prepend "S" so SRM-6 -> SSRM-6, LRM-15 -> SLRM-15.
  const isStreak = /streak/i.test(raw); // no \b: also catch glued "CLStreakLRM10"
  const key = normalizeWeaponName(raw);
  const mapped = WEAPON_ABBREV[key];
  if (mapped) {
    // The printed card prefixes Clan ballistic/missile weapons with "c"
    // (cSRM-2, cRAC/5) but leaves energy weapons bare (SLas, ER PPC).
    // Narc is a missile-family launcher: the card prints "cNarc" for Clan, so it
    // is NOT in the energy (bare) set.
    const energy = /laser|ppc|flamer|plasma|tag/.test(key);
    const label = isStreak ? `S${mapped}` : mapped;
    return techBase === "Clan" && !energy ? `c${label}` : label;
  }
  // Fallback: strip qualifiers/tech prefixes and split glued names, keep caps.
  let s = raw.replace(/\([^)]*\)/g, "").replace(/\s*\[ba\]/gi, "").trim();
  s = s.replace(/^(IS|CL|Clan|BA)\s+/i, "").replace(/^(IS|CL|BA)(?=[A-Z])/, "");
  s = s
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Look up TW damage for a weapon name; unknown=true when not in the table.
 * For Clan units, the Clan override table is consulted first (some weapons do
 * different damage by tech base, e.g. ER PPC: IS 10, Clan 15).
 */
export function lookupWeaponDamage(
  name: string,
  techBase: TechBase = "IS",
): { twDamage: number; unknown: boolean } {
  const key = normalizeWeaponName(name);
  // Range-varying missiles (MML, ATM/iATM) carry a bespoke profile, not a single
  // TW number, but they are KNOWN — report the printed max so callers don't flag
  // them as unknown weapons.
  const rvm = WEAPON_RV_MISSILE[key];
  if (rvm) return { twDamage: rvm.max, unknown: false };
  // SPECIAL-damage weapons (TSEMP) are known too, even with no numeric damage.
  if (key in WEAPON_SPECIAL_DAMAGE) return { twDamage: 0, unknown: false };
  const tw = techBase === "Clan" ? (WEAPON_DAMAGE_CLAN[key] ?? WEAPON_DAMAGE[key]) : WEAPON_DAMAGE[key];
  if (tw === undefined) return { twDamage: 0, unknown: true };
  return { twDamage: tw, unknown: false };
}

// ---------------------------------------------------------------------------
// Field conversions
// ---------------------------------------------------------------------------

/** Weapon group damage (the printed MAX): sum of TW damage / 3, round UP. v1: group of one. */
export function convertWeaponDamage(sumTw: number): number {
  return roundUp(sumTw / WEAPON_DAMAGE_DIVISOR);
}

/**
 * True if a normalized name starts with any family token in the list. A token
 * matches the whole name, a space-delimited prefix ("srm 6", "lb 10-x ac"), or
 * a slash-delimited prefix ("hag/30").
 */
function inFamily(normalizedName: string, families: ReadonlyArray<string>): boolean {
  return families.some(
    (family) =>
      normalizedName === family ||
      normalizedName.startsWith(`${family} `) ||
      normalizedName.startsWith(`${family}/`),
  );
}

/**
 * True if a normalized weapon name belongs to a missile family (rolls M dice).
 * Matches on the leading family token so "streak srm 6" hits "streak srm" (not
 * "srm"), and "rocket launcher 10" hits "rocket launcher".
 */
export function isMissileWeapon(normalizedName: string): boolean {
  return inFamily(normalizedName, MISSILE_WEAPON_FAMILIES);
}

/** True if a normalized weapon name is a cluster weapon (rolls C dice): LB-X, HAG, Silver Bullet Gauss. */
export function isClusterWeapon(normalizedName: string): boolean {
  return inFamily(normalizedName, CLUSTER_WEAPON_FAMILIES);
}

/** True if a cluster weapon's C dice fall off by range (HAG: short/med/long). */
export function isRangeVaryingCluster(normalizedName: string): boolean {
  return inFamily(normalizedName, RANGE_VARYING_CLUSTER_FAMILIES);
}

/** True if a weapon's max rounds to nearest rather than up. Rocket Launchers only (RL10 -> max 3, not 4). */
export function isRocketLauncher(normalizedName: string): boolean {
  return inFamily(normalizedName, ["rocket launcher"]);
}

/** Damage mechanic for a normalized weapon name (zero-damage entries stay direct). */
export function classifyDamage(normalizedName: string): DamageKind {
  if (normalizedName in WEAPON_DAMAGE_BY_RANGE) return "variable";
  if (isMissileWeapon(normalizedName)) return "missile";
  if (isClusterWeapon(normalizedName)) return "cluster";
  return "direct";
}

/**
 * Variable (range-dependent) flat damage from a TW [short, med, long] triple:
 * each bracket is ceil(TW/3). Printed `short|med|long` (SNPPC 4|3|2, HGauss 9|7|4).
 */
export function computeVariableProfile(twByRange: readonly [number, number, number]): DamageProfile {
  const byRange = twByRange.map(roundUp1Third);
  return { kind: "variable", base: byRange[byRange.length - 1]!, mDice: 0, cDice: [], byRange, max: byRange[0]! };
}

/** ceil(tw / 3) — the per-bracket Override damage value. */
function roundUp1Third(tw: number): number {
  return roundUp(tw / WEAPON_DAMAGE_DIVISOR);
}

/**
 * Derive the Override damage profile from a weapon's TW damage.
 *
 *   max   = ceil(rackTW / 3)
 *   base  = max(1, floor(rackTW / 10))   (missile/cluster; === max for direct)
 *   mDice = ceil(rackTW / 10)            (missile only)
 *   cDice = max − base                   (cluster only; HAG falls off −1 per bracket)
 *
 * Direct-fire and zero-damage entries collapse to a flat profile (base === max).
 */
export function computeDamageProfile(
  twDamage: number,
  kind: DamageKind,
  rangeVarying = false,
  maxRoundNearest = false,
): DamageProfile {
  // Rocket Launchers round their max to nearest (RL10 -> 3); everything else
  // rounds up. base/mDice are unaffected.
  const max = maxRoundNearest
    ? Math.round(twDamage / WEAPON_DAMAGE_DIVISOR)
    : convertWeaponDamage(twDamage);
  if (kind === "direct" || kind === "variable" || twDamage <= 0) {
    return { kind: "direct", base: max, mDice: 0, cDice: [], byRange: [], max };
  }
  const base = Math.max(1, Math.floor(twDamage / M_DICE_DIVISOR));
  if (kind === "missile") {
    return { kind, base, mDice: roundUp(twDamage / M_DICE_DIVISOR), cDice: [], byRange: [], max };
  }
  // cluster: base + cDice === max. Range-varying clusters (HAG) shed one C die
  // per bracket: [short, med, long].
  const top = max - base;
  const cDice = rangeVarying ? [top, top - 1, top - 2] : [top];
  return { kind, base, mDice: 0, cDice, byRange: [], max };
}

/**
 * Format a profile for the card:
 *   - missile:   `base+M{mDice} (max)`
 *   - rvmissile: `short|med|long+M{mDice} (max)` (MML, ATM/iATM)
 *   - cluster:   `base+C{cDice}` (HAG: `base+C{short}|{med}|{long}`)
 *   - variable:  `short|med|long`
 *   - direct:    flat `max`
 */
export function formatDamage(p: DamageProfile): string {
  const h = p.heatDamage ? `+H${p.heatDamage}` : ""; // plasma heat dice (e.g. "0+H2")
  if (p.kind === "missile") return `${p.base}+M${p.mDice} (${p.max})`;
  if (p.kind === "rvmissile") {
    // Collapse a flat profile (Arrow IV: 4|4|4) to a single base, "4+M1 (7)".
    const flat = p.byRange.every((v) => v === p.byRange[0]);
    const dmg = flat ? `${p.byRange[0]}` : p.byRange.join("|");
    return `${dmg}+M${p.mDice} (${p.max})`;
  }
  if (p.kind === "cluster" && p.cDice[0]! > 0) return `${p.base}+C${p.cDice.join("|")}`;
  if (p.kind === "variable") return `${p.byRange.join("|")}${h}`;
  return `${p.max}${h}`;
}

/**
 * Squad damage for `copies` identical weapons fired together, Battle-Armor style.
 *
 * Unlike a 'Mech TIC (which sums TW and divides once, capped per page 41), each
 * BA trooper fires its own copy independently. So the guaranteed base and any
 * M/C dice scale linearly with the copy count, while the printed max stays
 * ceil(totalTW / 3). Direct-fire and variable weapons collapse to a flat squad
 * value (base === max). Returns a flat zero profile for copies <= 0.
 *
 * Worked example (SRM 2, TW 4 each — single profile 1+M1 (2)):
 *   1 copy → 1+M1 (2)   2 → 2+M2 (3)   4 → 4+M4 (6)   5 → 5+M5 (7)
 */
export function scaleSquadDamage(weapon: CardWeapon, copies: number): DamageProfile {
  const m = Math.max(0, copies);
  const totalTw = weapon.twDamage * m;
  const max = convertWeaponDamage(totalTw);
  const p = weapon.profile;
  if (p.kind === "missile") {
    return { kind: "missile", base: p.base * m, mDice: p.mDice * m, cDice: [], byRange: [], max };
  }
  if (p.kind === "cluster") {
    return { kind: "cluster", base: p.base * m, mDice: 0, cDice: p.cDice.map((c) => c * m), byRange: [], max };
  }
  // direct, variable, or unknown -> flat squad damage.
  return { kind: "direct", base: max, mDice: 0, cDice: [], byRange: [], max };
}

// ---------------------------------------------------------------------------
// Range brackets (page 43, "Converting Weapon Ranges"). Each bracket reads a
// TW range value and returns a base modifier, or null when the bracket does
// not apply to the weapon ("–" on the card). The weapon's inherent to-hit
// modifier (WeaponRange.toHitMod) is layered on afterward by
// computeRangeBrackets.
// ---------------------------------------------------------------------------

/** Point Blank, from min range: ≥4 → +4, 1–3 → +2, 0 → +0. */
export function bracketPB(min: number): number {
  if (min >= 4) return 4;
  if (min >= 1) return 2;
  return 0;
}

/**
 * Short, from min range: ≥4 → +2, else +0.
 *
 * NOTE: page 43 reads "+2 if the min range value is 4", but DFA cards show LRM
 * (min range 6) at Short +2, so the rule is "4 OR MORE". The oracle wins.
 */
export function bracketS(min: number): number {
  return min >= 4 ? 2 : 0;
}

/** Medium, from medium range: 4–5 → +4, 6–12 → +2, ≥13 → +0, <4 → none. */
export function bracketM(medium: number): number | null {
  if (medium < 4) return null;
  if (medium <= 5) return 4;
  if (medium <= 12) return 2;
  return 0;
}

/** Long, from long range: 13–18 → +4, 19–30 → +2, ≥31 → +0, <13 → none. */
export function bracketL(long: number): number | null {
  if (long < 13) return null;
  if (long <= 18) return 4;
  if (long <= 30) return 2;
  return 0;
}

/** Extreme, from long range: 19–24 → +4, ≥25 → +2, <19 → none. */
export function bracketX(long: number): number | null {
  if (long < 19) return null;
  if (long <= 24) return 4;
  return 2;
}

/** Derive the five Override range brackets from a TW range profile, applying the inherent to-hit modifier. */
export function computeRangeBrackets(r: WeaponRange): RangeBrackets {
  const mod = r.toHitMod ?? 0;
  const add = (v: number | null) => (v === null ? null : v + mod);
  return {
    pb: add(bracketPB(r.min)),
    s: add(bracketS(r.min)),
    m: add(bracketM(r.medium)),
    l: add(bracketL(r.long)),
    x: add(bracketX(r.long)),
  };
}

/** Format one bracket value: null → "–", else a signed integer ("+4", "+0", "-2"). */
export function formatBracket(v: number | null): string {
  if (v === null) return "–";
  return v >= 0 ? `+${v}` : `${v}`;
}

/** Format the full range row "PB S M L X", e.g. "+4 +2 +0 +2 +4". */
export function formatRangeBrackets(b: RangeBrackets): string {
  return [b.pb, b.s, b.m, b.l, b.x].map(formatBracket).join(" ");
}

/** Arm/leg armor: TW / 3, round nearest, min 1. Returns 0 if the location is absent. */
function convertArmLegArmor(tw: number | undefined): number {
  if (tw === undefined) return 0;
  return Math.max(MIN_ARM_LEG_ARMOR, roundNearest(tw / ARM_LEG_ARMOR_DIVISOR));
}

/** Per-section structure: IS / 3, round nearest, min 1. Returns 0 if the location is absent. */
function convertStructure(is: number | undefined): number {
  if (is === undefined) return 0;
  return Math.max(MIN_STRUCTURE, roundNearest(is / STRUCTURE_DIVISOR));
}

/** Heat dissipated per round: count x (2 doubles | 1 single). */
function heatDissipatedPerRound(unit: Unit): number {
  const perSink =
    unit.heatSinks.type === "double" ? HEAT_PER_DOUBLE_SINK : HEAT_PER_SINGLE_SINK;
  return unit.heatSinks.count * perSink;
}

/**
 * Continuous heat generated by stealth/signature systems, which the Override
 * card pre-pays out of dissipation. Detected from the armor type (Stealth
 * Armor) and crit-slot names; each system counts once. Alpha Wolf Prime:
 * Stealth Armor = 10, so 28 dissipation − 10 -> 18 -> Sinks 4.
 */
export function heatGeneratingLoad(unit: Unit): number {
  const haystacks = [
    (unit.armorType ?? "").toLowerCase(),
    ...(unit.critSlots ?? []).map((s) => s.name.toLowerCase()),
  ];
  let heat = 0;
  for (const { match, heat: h } of HEAT_GENERATING_EQUIPMENT) {
    if (haystacks.some((s) => s.includes(match))) heat += h;
  }
  return heat;
}

/** Format the printed move string, appending " (J)" when jump MP > 0. */
export function formatMove(walk: number, run: number, jump: number): string {
  return `${walk}/${run}${jump > 0 ? " (J)" : ""}`;
}

/** Build the point-blank-only range row for a melee weapon (its to-hit mod in PB, rest "–"). */
function meleeRange(tnMod: number): RangeBrackets {
  return { pb: tnMod, s: null, m: null, l: null, x: null };
}

/**
 * Convert one parsed `Weapon` into a `CardWeapon` (damage profile + range
 * brackets). Exported so non-'Mech converters (e.g. Battle Armor) can reuse the
 * identical weapon engine. `mass` is only consulted for tonnage-scaled physical
 * melee weapons; pass 0 when it does not apply.
 */
/**
 * Detect a weapon's own tech base from its name prefix ("CLERLargeLaser" /
 * "Clan …" -> Clan; "ISMediumLaser" / "Inner Sphere …" -> IS), or null when the
 * name carries no tech marker. Used so a Mixed-tech 'Mech converts each weapon
 * on its own tech, rather than forcing the whole unit onto one table.
 */
/** Total Warfare heat for a weapon (single shot), 0 when not in WEAPON_HEAT. */
export function lookupWeaponHeat(name: string): number {
  return WEAPON_HEAT[normalizeWeaponName(name)] ?? 0;
}

/** Override Ht for a TIC: round(sum of member TW heat / 5), the heat-sink scale
 * (round-nearest, VERIFIED vs DFA card: SRM-2 heat 2 -> 0, cATM-12 heat 8 -> 2). */
export function ticHeat(tic: Tic): number {
  const tw = tic.weapons.reduce((sum, w) => sum + lookupWeaponHeat(w.name), 0);
  return roundNearest(tw / HEAT_DISSIPATION_DIVISOR);
}

/**
 * Display label for a TIC on the card: count prefix ("x2"), the Clan "c"
 * abbreviation via the weapon's own tech, and a "(RF)" suffix for rapid-fire
 * autocannon (Rotary / Ultra). Mixed-name groups keep the TIC's plain label.
 */
export function abbreviatedTicLabel(tic: Tic, unitTech: TechBase): string {
  const names = tic.weapons.map((w) => w.name);
  if (!names.every((n) => n === names[0])) return tic.label;
  const name = names[0]!;
  const tech = detectWeaponTech(name) ?? unitTech;
  let ab = abbreviateWeapon(name, tech);
  if (/\b(rotary|ultra)\b/i.test(name) || /^(rac|uac|crac|cuac)/i.test(ab)) ab += " (RF)";
  return tic.count > 1 ? `x${tic.count} ${ab}` : ab;
}

/**
 * Build one rendered weapon row (used by the vehicle / fighter / dropship cards
 * and their TIC editor) from a TIC plus its arc/facing short code. Keeping this
 * shared means the editor's regrouped rows match the converter's exactly.
 */
export function ticRow(tic: Tic, techBase: TechBase, facingCode: string): VehicleWeaponRow {
  return {
    label: abbreviatedTicLabel(tic, techBase),
    facing: facingCode,
    damageText: tic.damageText,
    heat: ticHeat(tic),
    range: tic.range,
    rangeText: tic.rangeText,
    unknown: tic.weapons.some((w) => w.unknown),
  };
}

export function detectWeaponTech(raw: string): TechBase | null {
  const s = raw.trim().replace(/^\d+\s+/, ""); // tolerate a leading count ("1 ISERPPC")
  // Attached tech prefix glued to an uppercase acronym ("CLERPPC", "ISMediumLaser"):
  // case-insensitive so all-caps MegaMek spellings resolve, not just lowercase "cl"/"is".
  if (/^cl(?=[A-Z])/i.test(s) || /^clan\b/i.test(s)) return "Clan";
  if (/^is(?=[A-Z])/i.test(s) || /^(is|inner sphere)\b/i.test(s)) return "IS";
  return null;
}

export function convertWeapon(w: Weapon, techBase: TechBase, mass: number, capitalScale = false): CardWeapon {
  const key = normalizeWeaponName(w.name);
  // A weapon's own CL/IS prefix wins over the unit's nominal base (Mixed tech).
  const wtech = detectWeaponTech(w.name) ?? techBase;
  // Capital-scale targets (WarShips): a STANDARD-scale weapon does 1/10 its
  // damage against capital armor (StratOps). Capital/naval weapons are already
  // capital scale, so they are exempt. Divides the TW damage before the ÷3.
  const dmgDiv = capitalScale && !isWarshipWeapon(w.name) ? CAPITAL_SCALE_DIVISOR : 1;

  // Physical melee weapons (Hatchet/Sword/Mace/Claws): damage from tonnage, not
  // a TW table; point-blank only, with a flat to-hit modifier (page 40).
  const meleeSpec = MELEE_WEAPONS[key];
  if (meleeSpec) {
    const dmg = roundUp(mass / meleeSpec.divisor);
    const profile: DamageProfile = { kind: "direct", base: dmg, mDice: 0, cDice: [], byRange: [], max: dmg };
    const range = meleeRange(meleeSpec.tnMod);
    return {
      name: w.name,
      location: w.location,
      rawLocation: w.rawLocation,
      rearMounted: w.rearMounted,
      twDamage: dmg,
      damage: dmg,
      profile,
      damageText: formatDamage(profile),
      range,
      rangeText: formatRangeBrackets(range),
      unknown: false,
    };
  }

  // SPECIAL-damage weapons (TSEMP): the damage cell is a literal label; range
  // and heat come from the normal tables (a bracket override may apply).
  const special = WEAPON_SPECIAL_DAMAGE[key];
  if (special) {
    const profile: DamageProfile = { kind: "variable", base: 0, mDice: 0, cDice: [], byRange: [], max: 0 };
    const rangeData = (wtech === "Clan" ? WEAPON_RANGES_CLAN[key] : undefined) ?? WEAPON_RANGES[key];
    const range = WEAPON_BRACKET_OVERRIDE[key] ?? (rangeData ? computeRangeBrackets(rangeData) : null);
    return {
      name: w.name,
      location: w.location,
      rawLocation: w.rawLocation,
      rearMounted: w.rearMounted,
      twDamage: 0,
      damage: 0,
      profile,
      damageText: special,
      range,
      rangeText: range ? formatRangeBrackets(range) : null,
      unknown: false,
    };
  }

  // Range-varying missile racks (MML, ATM/iATM, Arrow IV): per-bracket base + M
  // dice, from the bespoke WEAPON_RV_MISSILE table rather than the single-TW
  // formula. A literal bracket override (Arrow IV) wins over the computed row.
  const rvm = WEAPON_RV_MISSILE[key];
  if (rvm) {
    const profile: DamageProfile = {
      kind: "rvmissile",
      base: 0,
      mDice: rvm.mDice,
      cDice: [],
      byRange: [...rvm.byRange],
      max: rvm.max,
    };
    const rangeData = (wtech === "Clan" ? WEAPON_RANGES_CLAN[key] : undefined) ?? WEAPON_RANGES[key];
    const range = WEAPON_BRACKET_OVERRIDE[key] ?? (rangeData ? computeRangeBrackets(rangeData) : null);
    return {
      name: w.name,
      location: w.location,
      rawLocation: w.rawLocation,
      rearMounted: w.rearMounted,
      twDamage: rvm.max,
      damage: rvm.max,
      profile,
      damageText: formatDamage(profile),
      range,
      rangeText: range ? formatRangeBrackets(range) : null,
      unknown: false,
    };
  }

  const { twDamage: rawTw, unknown } = lookupWeaponDamage(w.name, wtech);
  // Capital-scale reduction (WarShip standard weapons) divides the TW input.
  const twDamage = rawTw / dmgDiv;
  // v1: one weapon per TIC, so each weapon is its own group.
  // TODO(TIC grouping): replace per-weapon conversion with grouped sums.
  const byRange = WEAPON_DAMAGE_BY_RANGE[key];
  const baseProfile =
    dmgDiv !== 1
      ? // Capital-scale reduction: collapse to a flat reduced value. Missile /
        // cluster mechanics are meaningless at 1/10 (and scaling base + M dice
        // by count would exceed the reduced max).
        computeDamageProfile(twDamage, "direct")
      : !unknown && byRange
        ? computeVariableProfile(byRange)
        : computeDamageProfile(
            twDamage,
            unknown ? "direct" : classifyDamage(key),
            isRangeVaryingCluster(key),
            isRocketLauncher(key),
          );
  // Plasma weapons add heat dice to the target ("+H{n}") on top of their damage.
  const heatDamage = WEAPON_HEAT_DAMAGE[key];
  const profile = heatDamage ? { ...baseProfile, heatDamage } : baseProfile;
  // Range data is a separate, growing table; weapons absent from it have no row.
  // Clan ranges diverge for some weapons (ER lasers, RACs) — consult the Clan
  // override table first for Clan units, then fall back to the shared table. A
  // literal bracket override (range-varying to-hit, e.g. VSP) wins over both.
  const rangeData =
    (wtech === "Clan" ? WEAPON_RANGES_CLAN[key] : undefined) ?? WEAPON_RANGES[key];
  const range =
    WEAPON_BRACKET_OVERRIDE[key] ?? (rangeData ? computeRangeBrackets(rangeData) : null);
  return {
    name: w.name,
    location: w.location,
    rawLocation: w.rawLocation,
    rearMounted: w.rearMounted,
    twDamage,
    damage: profile.max,
    profile,
    damageText: formatDamage(profile),
    range,
    rangeText: range ? formatRangeBrackets(range) : null,
    unknown,
  };
}

// ---------------------------------------------------------------------------
// TIC grouping (page 41). Auto-group identical weapons in the same location and
// facing, summing their TW before the ÷3, subject to the base/max caps. A
// single weapon is always its own legal TIC even if it exceeds the caps.
// ---------------------------------------------------------------------------

/**
 * Damage used for the ≤ TIC_MAX_BASE cap. Missiles count only their guaranteed
 * base (M dice are not guaranteed); cluster and direct count the full value
 * (clusters can be slug-fired), which equals max.
 */
export function ticCapBase(p: DamageProfile): number {
  return p.kind === "missile" ? p.base : p.max;
}

/** True if a combined profile is within both TIC caps (page 41). */
export function isLegalTicProfile(p: DamageProfile): boolean {
  return ticCapBase(p) <= TIC_MAX_BASE && p.max <= TIC_MAX_DAMAGE;
}

/**
 * Location key used for TIC grouping. The Override card treats the whole torso
 * as one location, so identical weapons split across CT/LT/RT (e.g. one LRM-15
 * in each side torso) group into a single TIC ("x2 cLRM-15" @ T). Rear-torso
 * sections collapse together too; arms, legs, and head stay distinct.
 */
export function groupingLocation(loc: CardWeapon["location"]): string {
  if (loc === "CT" || loc === "LT" || loc === "RT") return "T";
  if (loc === "CTR" || loc === "LTR" || loc === "RTR") return "Tr";
  return loc;
}

/**
 * True if a proposed set of weapons forms a legal TIC: a single weapon is
 * always legal (even over-cap, e.g. Heavy Gauss); a group must be within the
 * caps and share one location/facing. Used by the editable-grouping UI.
 */
export function isLegalTic(members: CardWeapon[]): boolean {
  if (members.length === 0) return false;
  if (members.length === 1) return true;
  const first = members[0]!;
  const sameLocation = members.every(
    (m) =>
      groupingLocation(m.location) === groupingLocation(first.location) &&
      m.rearMounted === first.rearMounted,
  );
  return sameLocation && isLegalTicProfile(buildTic(members).profile);
}

/** Only flat/missile/cluster weapons auto-group; variable, melee, and unknown stand alone. */
function isGroupable(w: CardWeapon): boolean {
  return !w.unknown && (w.profile.kind === "direct" || w.profile.kind === "missile" || w.profile.kind === "cluster");
}

/**
 * Build a TIC from a set of weapons (the unit of manual editing). A single
 * weapon keeps its own profile. For a group, TW is summed and a combined
 * profile derived: missile if any member rolls M dice, else cluster if any
 * rolls C dice, else direct. Range brackets show only when every member shares
 * the same range (mixed-range groups print no bracket row).
 *
 * Callers are responsible for legality (isLegalTicProfile) and for keeping a
 * group within one location/facing — buildTic does not enforce either.
 */
export function buildTic(members: CardWeapon[]): Tic {
  const first = members[0]!;
  if (members.length === 1) {
    return {
      weapons: members,
      label: first.name,
      location: first.location,
      rearMounted: first.rearMounted,
      count: 1,
      profile: first.profile,
      damageText: first.damageText,
      range: first.range,
      rangeText: first.rangeText,
    };
  }

  const keys = members.map((m) => normalizeWeaponName(m.name));
  const summedTw = members.reduce((sum, m) => sum + m.twDamage, 0);
  const allSameName = keys.every((k) => k === keys[0]);

  // For a group of IDENTICAL weapons, scale the single weapon's profile by the
  // count — base and M/C dice grow linearly, max = ceil(sumTW / 3). This matches
  // the printed card (2x cLRM-15 -> 2+M4 (10), not floor(30/10)=3). A mixed-name
  // group (rare; LRM 10 + LRM 5) falls back to a summed profile.
  const kinds = new Set(members.map((m) => m.profile.kind));
  const kind: DamageKind = kinds.has("missile") ? "missile" : kinds.has("cluster") ? "cluster" : "direct";
  const rangeVarying = keys.some(isRangeVaryingCluster);
  const allRocket = keys.every(isRocketLauncher);
  const profile = allSameName
    ? scaleSquadDamage(first, members.length)
    : computeDamageProfile(summedTw, kind, rangeVarying, allRocket);

  // Compact label: "5x ER PPC" for one type, else counts per type joined with
  // "+" ("2x Large Laser + 2x Medium Laser") rather than listing every weapon.
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
  const label = allSameName
    ? `${members.length}x ${first.name}`
    : [...counts].map(([n, c]) => (c > 1 ? `${c}x ${n}` : n)).join(" + ");
  const sameRange = members.every((m) => m.rangeText === first.rangeText);
  if (sameRange) {
    return {
      weapons: members,
      label,
      location: first.location,
      rearMounted: first.rearMounted,
      count: members.length,
      profile,
      damageText: formatDamage(profile),
      range: first.range,
      rangeText: first.rangeText,
    };
  }

  // MIXED-RANGE group (a weapon bay of different-reach weapons): a bay totals
  // only the weapons IN RANGE of the target, so its damage falls off with range.
  // At each tier sum the TW of the members that reach it (short = all), and show
  // the range row of the longest-reaching member as the bay's outer envelope.
  const ext = (m: CardWeapon) => reachExtent(m.range);
  const sumWhere = (minExt: number) =>
    members.reduce((s, m) => s + (ext(m) >= minExt ? m.twDamage : 0), 0);
  const varied = computeVariableProfile([summedTw, sumWhere(3), sumWhere(4)]);
  const widest = members.reduce((a, b) => (ext(b) > ext(a) ? b : a), first);
  return {
    weapons: members,
    label,
    location: first.location,
    rearMounted: first.rearMounted,
    count: members.length,
    profile: varied,
    damageText: formatDamage(varied),
    range: widest.range,
    rangeText: widest.rangeText,
  };
}

/** How far a weapon reaches, as a bracket rank (X=5 … PB=1, none=0). */
function reachExtent(r: RangeBrackets | null): number {
  if (!r) return 0;
  if (r.x != null) return 5;
  if (r.l != null) return 4;
  if (r.m != null) return 3;
  if (r.s != null) return 2;
  if (r.pb != null) return 1;
  return 0;
}

/**
 * Auto-group converted weapons into TICs. Identical weapons (same normalized
 * name, location, and facing) are greedily packed into the largest legal TIC,
 * remainder spilling into further TICs. Order follows first appearance.
 */
export function groupIntoTics(weapons: CardWeapon[]): Tic[] {
  const tics: Tic[] = [];
  const used = new Array(weapons.length).fill(false);

  for (let i = 0; i < weapons.length; i++) {
    if (used[i]) continue;
    const w = weapons[i]!;
    used[i] = true;
    const key = normalizeWeaponName(w.name);

    if (!isGroupable(w)) {
      tics.push(buildTic([w])); // variable/melee/unknown: never grouped
      continue;
    }

    // Gather all identical, groupable weapons (same type, location, facing).
    const members = [w];
    for (let j = i + 1; j < weapons.length; j++) {
      const x = weapons[j]!;
      if (
        !used[j] &&
        isGroupable(x) &&
        groupingLocation(x.location) === groupingLocation(w.location) &&
        x.rearMounted === w.rearMounted &&
        normalizeWeaponName(x.name) === key
      ) {
        members.push(x);
        used[j] = true;
      }
    }

    // Greedily pack: largest leading subset that stays within the caps (k ≥ 1).
    let remaining = members;
    while (remaining.length > 0) {
      let k = remaining.length;
      while (k > 1) {
        if (isLegalTicProfile(buildTic(remaining.slice(0, k)).profile)) break;
        k--;
      }
      tics.push(buildTic(remaining.slice(0, k)));
      remaining = remaining.slice(k);
    }
  }

  return tics;
}

// ---------------------------------------------------------------------------
// Equipment surfacing: ammo (with bin count) and important gear, from crit slots.
// ---------------------------------------------------------------------------

/**
 * Canonical rounds per ton of ammunition, by weapon type (Total Warfare /
 * TechManual). Returns undefined for ammo we don't have a fixed count for — the
 * card then falls back to showing tons. Reads the raw crit name (and its
 * de-glued form) so MegaMek's glued BLK spellings still match, e.g.
 * "ISRotaryAC5 Ammo", "ISLBXAC10 Ammo", "ISAMS Ammo".
 */
export function ammoShotsPerTon(rawName: string): number | undefined {
  const s = `${rawName} ${normalizeWeaponName(rawName)}`.toLowerCase();
  if (/\(os\)|one-?shot/.test(s)) return 1; // one-shot launchers carry a single round
  const pick = (n: number, tbl: Record<number, number>): number | undefined => tbl[n];
  const num = (re: RegExp): number => Number(s.match(re)?.[1] ?? 0);
  const acClass: Record<number, number> = { 2: 45, 4: 25, 5: 20, 10: 10, 20: 5 };

  // Gauss family (check the specials before the generic "gauss").
  if (/light gauss/.test(s)) return 16;
  if (/heavy ?gauss/.test(s)) return 4; // standard + Improved Heavy Gauss
  if (/magshot/.test(s)) return 50;
  if (/silver ?bullet|sb ?gauss/.test(s)) return 8;
  if (/hyper-?assault|\bhag\b/.test(s)) return pick(num(/(?:hag|gauss rifle)\/?\s*(\d+)/), { 20: 6, 30: 4, 40: 3 });
  if (/gauss/.test(s)) return 8;

  // Autocannons: standard, LB-X, Ultra, Rotary, Light AC (all share the per-class count).
  if (/autocannon|ultra ?ac|rotary ?ac|\blac\b|lbx?|\bac\b|ac\/|ac\d/.test(s)) {
    const n = num(/(\d+)-x/) || num(/lbx?ac(\d+)/) || num(/rotaryac(\d+)/) || num(/ac\s*\/?\s*(\d+)/);
    return pick(n, acClass);
  }

  // Missiles.
  if (/mml/.test(s)) {
    const n = num(/mml[ -]?(\d+)/);
    return /lrm/.test(s) ? pick(n, { 3: 40, 5: 24, 7: 17, 9: 13 }) : pick(n, { 3: 33, 5: 20, 7: 14, 9: 11 });
  }
  if (/extended ?lrm|\belrm/.test(s)) return pick(num(/(?:extended ?lrm|elrm)[ -]?(\d+)/), { 5: 18, 10: 9, 15: 6, 20: 4 });
  if (/\blr[mt]\b|lr[mt][ -]?\d/.test(s)) return pick(num(/lr[mt][ -]?(\d+)/), { 5: 24, 10: 12, 15: 8, 20: 6 });
  if (/\bmrm/.test(s)) return pick(num(/mrm[ -]?(\d+)/), { 10: 24, 20: 12, 30: 8, 40: 6 });
  if (/\bsr[mt]\b|sr[mt][ -]?\d/.test(s)) return pick(num(/sr[mt][ -]?(\d+)/), { 2: 50, 4: 25, 6: 15 }); // incl. Streak
  if (/\bi?atm/.test(s)) return pick(num(/atm[ -]?(\d+)/), { 3: 20, 6: 10, 9: 7, 12: 5 });

  // Other ammo-fed weapons.
  if (/plasma/.test(s)) return 10; // Plasma Rifle (IS) + Plasma Cannon (Clan)
  if (/heavy ?machine ?gun|heavy ?mg|\bhmg\b/.test(s)) return 100;
  if (/machine ?gun|\bmg\b/.test(s)) return 200; // standard + light MG
  if (/\bams\b|isams|clams|laser ?ams|anti-?missile/.test(s)) return 12;
  if (/inarc/.test(s)) return 4;
  if (/narc/.test(s)) return 6;
  if (/fluid ?gun|sprayer|vehicle ?flamer|vflamer/.test(s)) return 20;
  if (/arrow ?iv/.test(s)) return 5;
  if (/long ?tom/.test(s)) return 5;
  if (/sniper/.test(s)) return 10;
  if (/thumper/.test(s)) return 20;
  return undefined;
}

/** Clean an ammo crit name into a label like "AC/20 Ammo". */
export function ammoLabel(raw: string): string {
  let s = raw
    .replace(/\((?:[^)]*)\)/g, " ") // drop "(Half)", "(Clan)" etc.
    .replace(/\bammo\b/gi, " ")
    .replace(/^\s*(is|cl|clan)\b/i, " ") // leading spaced tech prefix
    .replace(/^\s*(is|cl)(?=[a-z])/i, " ") // leading attached tech prefix (ISAC20)
    .replace(/\b(half|full)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s ? `${s} Ammo` : "Ammo";
}

/**
 * Derive notable equipment from crit slots: ammo (counted by bin) and the
 * curated important-gear list. Grouped by location + label; ammo and jump jets
 * are tallied, other gear shown once. Ordered by location, ammo last.
 */
/**
 * Collapse the three torso sections (and their rears) onto a single canonical
 * "CT" location: Override has only one "Torso", so torso-mounted equipment is
 * merged and displayed there (e.g. LRM ammo in LT + RT -> one "LRM Ammo @ T").
 */
function equipmentLocation(loc: CritSlot["location"]): CritSlot["location"] {
  return loc === "LT" || loc === "RT" || loc === "CTR" || loc === "LTR" || loc === "RTR"
    ? "CT"
    : loc;
}

/**
 * Equipment that MegaMek lists in the `Weapons:` block (it has a to-hit/range in
 * Total Warfare) but Override treats as non-damaging EQUIPMENT — AMS, Laser AMS,
 * TAG, ECM, C3, Active Probe, etc. Such lines are pulled out of the weapons list
 * and shown on the equipment line instead of becoming a (zero-damage, unknown)
 * weapon TIC. Any item recognised by IMPORTANT_EQUIPMENT qualifies (none of the
 * support-gear match tokens collide with a real weapon name).
 */
export function isWeaponBlockEquipment(name: string): boolean {
  const lower = name.toLowerCase();
  // Also test the normalized name so BLK's glued spellings de-glue to match the
  // space-containing tokens ("ISLaserInsulator" -> "laser insulator").
  const norm = normalizeWeaponName(name);
  return IMPORTANT_EQUIPMENT.some((e) => e.match.some((m) => lower.includes(m) || norm.includes(m)));
}

/**
 * Non-weapon lines that BLK files list in the Weapons: block but that carry no
 * damage of their own: ammo bins, cargo, and Narc pods (the launcher is the
 * weapon; the pods are its ammo). These are pulled out so they don't surface as
 * zero-damage "unknown" weapons. Ammo bins still reach the equipment line (the
 * ammo path in buildEquipment keys on "ammo"); cargo and pods are dropped.
 */
export function isNonWeaponMount(name: string): boolean {
  // No leading \b: MegaMek glues these ("ISPlasmaRifleAmmo", "ISNarc Pods").
  return /ammo/i.test(name) || /\bcargo\b/i.test(name) || /narc pods/i.test(name);
}

/**
 * Capital- and sub-capital-scale weapons (and their ammo): Capital/Sub-Capital
 * Missile Launchers, Sub-Capital Cannons/Lasers, Screen Launchers, and the
 * named capital missiles (AR10, Killer Whale, White Shark, Barracuda, Piranha,
 * Stingray, Manta Ray). Override has no 'Mech-scale stats for these, so on the
 * drone DropShips/pocket-warships that carry them they are suppressed entirely
 * (no row, no warning) rather than printed as zero-damage unknowns.
 */
/**
 * Heuristic gate for the vehicle / aero / proto / dropship paths: an UNKNOWN
 * mount is only shown as a weapon row when its name looks like a weapon (so
 * sensors, chassis mods, etc. don't surface as zero-damage rows). Checks both
 * the raw name and its normalized form, so glued BLK spellings de-glue to match
 * a multi-word token ("ISLongTom" -> "long tom", "ISCruiseMissile50" matches
 * "cruise missile"). 'Mechs show every weapon and do not use this gate.
 */
export function looksLikeWeapon(name: string): boolean {
  const lower = name.toLowerCase();
  const norm = normalizeWeaponName(name);
  return WEAPON_HINTS.some((h) => lower.includes(h) || norm.includes(h));
}

export function isWarshipWeapon(name: string): boolean {
  return (
    /\bcapital\b/i.test(name) || // "Capital ..." and "Sub-Capital ..."
    /\bnaval\b/i.test(name) || // Naval Autocannon (NAC), Naval Laser (NL), Naval PPC
    /mass driver/i.test(name) ||
    /\b(nac|nppc|sub-capital)\b/i.test(name) ||
    /screen launcher/i.test(name) ||
    /tele-?operated/i.test(name) || // tele-operated capital missiles (Kraken, etc.)
    /\b(ar10|killer whale|white shark|barracuda|piranha|stingray|manta ray|kraken)\b/i.test(name)
  );
}

/**
 * Notable construction options carried on the header lines (Engine: / Gyro: /
 * Armor: / Structure: / Cockpit:) rather than as crit slots, surfaced as
 * body-wide equipment so they reach the card: XL/XXL/Light/Compact engines (with
 * IS/Clan tech for XL/XXL), XL/Compact/Heavy-Duty gyros, Hardened/Reflective/
 * Reactive armor, Reinforced/Composite structure, Torso-Mounted/Command Console
 * cockpits, etc. Efficiency choices (Endo Steel, Ferro-Fibrous, Standard fusion,
 * Standard gyro) and Stealth (already shown from its crit slots) are skipped.
 */
export function constructionEquipment(unit: Unit): CardEquipment[] {
  const items: string[] = [];

  // Engine: skip standard fusion; XL/XXL carry their IS/Clan tech (survivability differs).
  const engType = unit.engine.type.toLowerCase();
  const engHit = SPECIAL_ENGINE.find((e) => e.match.some((m) => engType.includes(m)));
  if (engHit) items.push(engHit.tech ? `${engHit.label} (${unit.engine.clan ? "Clan" : "IS"})` : engHit.label);

  const gyro = (unit.gyroType ?? "").toLowerCase();
  const gyroHit = SPECIAL_GYRO.find((e) => e.match.some((m) => gyro.includes(m)));
  if (gyroHit) items.push(gyroHit.label);

  const armor = (unit.armorType ?? "").toLowerCase();
  const armorHit = SPECIAL_ARMOR.find((e) => e.match.some((m) => armor.includes(m)));
  if (armorHit) items.push(armorHit.label);

  const struct = (unit.structureType ?? "").toLowerCase();
  if (struct.includes("reinforced")) items.push("Reinforced Structure");
  else if (struct.includes("composite") && !struct.includes("endo")) items.push("Composite Structure");

  const cockpit = (unit.cockpitType ?? "").toLowerCase();
  const cockpitHit = SPECIAL_COCKPIT.find((e) => e.match.some((m) => cockpit.includes(m)));
  if (cockpitHit) items.push(cockpitHit.label);

  return items.map((label) => ({ label, location: "CT" as const, category: "equipment" as const, count: 1, global: true }));
}

export function buildEquipment(critSlots: ReadonlyArray<CritSlot>): CardEquipment[] {
  const byKey = new Map<string, CardEquipment>();
  const bump = (
    label: string,
    location: CritSlot["location"],
    category: "ammo" | "equipment",
    countable: boolean,
    global = false,
    shots = 0,
  ) => {
    // Body-wide systems (global) are keyed by label alone, so their per-location
    // crit slots collapse to a single, location-less entry.
    const key = global ? `*|${category}|${label}` : `${location}|${category}|${label}`;
    const existing = byKey.get(key);
    if (existing) {
      if (countable) existing.count += 1;
      if (shots) existing.shots = (existing.shots ?? 0) + shots;
    } else {
      byKey.set(key, { label, location, category, count: 1, ...(shots ? { shots } : {}), ...(global ? { global: true } : {}) });
    }
  };

  for (const slot of critSlots) {
    const lower = slot.name.toLowerCase();
    const norm = normalizeWeaponName(slot.name); // de-glue BLK names ("ISMGA" -> "machine gun array")
    const loc = equipmentLocation(slot.location); // CT/LT/RT -> one "Torso"
    if (lower.includes("ammo")) {
      // Each bin = 1 ton; "(Half)" bins carry half the rounds.
      const per = ammoShotsPerTon(slot.name);
      const shots = per == null ? 0 : Math.max(1, Math.round(per * (/\bhalf\b/i.test(slot.name) ? 0.5 : 1)));
      bump(ammoLabel(slot.name), loc, "ammo", true, false, shots);
      continue;
    }
    const match = IMPORTANT_EQUIPMENT.find((e) => e.match.some((m) => lower.includes(m) || norm.includes(m)));
    if (match) bump(match.label, loc, "equipment", match.countable ?? false, match.unique ?? false);
  }

  const locRank = (loc: CardEquipment["location"]) => {
    const i = LOCATION_ORDER.indexOf(loc);
    return i < 0 ? LOCATION_ORDER.length : i;
  };
  return [...byKey.values()].sort(
    (a, b) =>
      Number(a.category === "ammo") - Number(b.category === "ammo") || // equipment first
      locRank(a.location) - locRank(b.location) ||
      a.label.localeCompare(b.label),
  );
}

// ---------------------------------------------------------------------------
// Top-level conversion
// ---------------------------------------------------------------------------

/**
 * Convert a parsed `Unit` into an `OverrideCard`.
 *
 * TODO(range brackets): apply page-43 range-bracket modifiers to weapon damage.
 * TODO(M/C dice): derive Movement/Combat dice.
 */
/** Physical/melee weapons (Hatchet, Sword, …) are listed only in the crit slots,
 * not the Weapons block, and occupy several contiguous slots. Surface one Weapon
 * per (melee type + location), skipping any already declared in the Weapons block. */
function meleeWeaponsFromCrits(crits: ReadonlyArray<CritSlot>, declared: ReadonlyArray<Weapon>): Weapon[] {
  const seen = new Set<string>();
  for (const w of declared) {
    const k = normalizeWeaponName(w.name);
    if (MELEE_WEAPONS[k]) seen.add(`${k}@${w.location}`);
  }
  const out: Weapon[] = [];
  for (const s of crits) {
    const k = normalizeWeaponName(s.name);
    if (!MELEE_WEAPONS[k]) continue;
    const id = `${k}@${s.location}`;
    if (seen.has(id)) continue; // one per limb; collapses a hatchet's multiple slots
    seen.add(id);
    const name = s.name.replace(/\s*\([^)]*\)/g, "").replace(/:[A-Za-z0-9]+$/, "").trim();
    out.push({ name, location: s.location, rawLocation: s.rawLocation, rearMounted: false });
  }
  return out;
}

/** MASC and/or a Supercharger boost the run profile (Override house rule): one
 * device multiplies movement by 1.25, both by 1.5. `names` are the crit-slot /
 * equipment-mount names to scan. Returns 1 when neither is present. */
export function moveBoostFactor(names: ReadonlyArray<string>): number {
  const lower = names.map((n) => n.toLowerCase());
  const masc = lower.some((n) => /masc/.test(n));
  const supercharger = lower.some((n) => /supercharger/.test(n));
  return masc && supercharger ? 1.5 : masc || supercharger ? 1.25 : 1;
}

export function convertUnit(unit: Unit): OverrideCard {
  const a = unit.armor;
  const warnings: string[] = [];

  // Torso / rear armor (missing locations count as 0).
  const torso = roundNearest(
    ((a.CT ?? 0) + (a.LT ?? 0) + (a.RT ?? 0)) / TORSO_ARMOR_DIVISOR,
  );
  const rear = roundNearest(
    ((a.CTR ?? 0) + (a.LTR ?? 0) + (a.RTR ?? 0)) / REAR_ARMOR_DIVISOR,
  );
  const head = lookupHeadArmor(a.HD ?? 0);

  // Per-section structure: IS / 3, round nearest, min 1. Torso uses CT internal,
  // except where a tonnage correction matches the official builder more closely.
  const s = unit.structure;
  const structure = {
    torso: TORSO_STRUCTURE_BY_TONNAGE[unit.mass] ?? convertStructure(s.CT),
    head: convertStructure(s.HD),
    leftArm: convertStructure(s.LA),
    rightArm: convertStructure(s.RA),
    leftLeg: convertStructure(s.LL),
    rightLeg: convertStructure(s.RL),
    // Tripod center leg only (omitted otherwise).
    ...(s.CL !== undefined ? { centerLeg: convertStructure(s.CL) } : {}),
  };

  // Stealth/signature systems burn heat every round; the card pre-pays it out
  // of dissipation before the /5 (Alpha Wolf Prime: 28 − 10 stealth -> 4).
  const netDissipation = Math.max(0, heatDissipatedPerRound(unit) - heatGeneratingLoad(unit));
  const heatDissipation = roundNearest(netDissipation / HEAT_DISSIPATION_DIVISOR);

  // MASC / Supercharger boost: scale walk, then re-derive run so run stays
  // walk × 1.5 (e.g. Walk 5 with both → 8 / 12).
  const boost = moveBoostFactor((unit.critSlots ?? []).map((s) => s.name));
  const walkMP = boost > 1 ? roundUp(unit.movement.walkMP * boost) : unit.movement.walkMP;
  const runMP = boost > 1 ? roundUp(walkMP * RUN_MP_MULTIPLIER) : unit.movement.runMP;
  const tmm = lookupTmm(runMP);

  // Split the Weapons block: AMS / Laser AMS / TAG are equipment in Override, not
  // weapons, so divert them to the equipment line (via pseudo crit slots) instead
  // of converting them into zero-damage "unknown" TICs.
  const weaponMounts: Weapon[] = [];
  const divertedEquipment: CritSlot[] = [];
  const meleeMounts = meleeWeaponsFromCrits(unit.critSlots ?? [], unit.weapons);
  for (const w of [...unit.weapons, ...meleeMounts]) {
    if (isNonWeaponMount(w.name)) {
      // Ammo bins reach the ammo line via buildEquipment; cargo/pods are dropped.
      if (/ammo/i.test(w.name)) {
        divertedEquipment.push({ name: w.name, location: w.location, rawLocation: w.rawLocation });
      }
    } else if (isWeaponBlockEquipment(w.name)) {
      divertedEquipment.push({ name: w.name, location: w.location, rawLocation: w.rawLocation });
    } else {
      weaponMounts.push(w);
    }
  }

  const weapons = weaponMounts.map((w) => convertWeapon(w, unit.techBase, unit.mass));
  for (const w of weapons) {
    if (w.unknown) {
      warnings.push(`weapon not in TW damage table: "${w.name}" (damage set to 0)`);
    }
  }

  // Universal Punch/Kick: Override damage = ceil(classic TW / 3), classic TW =
  // ceil(mass/10) punch, ceil(mass/5) kick. VERIFIED 100t -> 4 / 7. Quad 'Mechs
  // have no arms and cannot punch, so their punch is suppressed (0).
  const isQuad = /quad/i.test(unit.config);
  const melee = {
    punch: isQuad ? 0 : roundUp(roundUp(unit.mass / PUNCH_TW_DIVISOR) / WEAPON_DAMAGE_DIVISOR),
    kick: roundUp(roundUp(unit.mass / KICK_TW_DIVISOR) / WEAPON_DAMAGE_DIVISOR),
  };

  return {
    name: `${unit.chassis} ${unit.model}`.trim(),
    chassis: unit.chassis,
    model: unit.model,
    mass: unit.mass,
    techBase: unit.techBase,
    config: unit.config,
    move: formatMove(walkMP, runMP, unit.movement.jumpMP),
    walkMove: walkMP,
    runMove: runMP,
    jump: unit.movement.jumpMP,
    tmm,
    tmmSprint: tmm + TMM_SPRINT_BONUS,
    // Jump is its own movement mode: TMM = the normal bracket for the jump
    // distance, +2 (0 when the unit can't jump).
    tmmJump: unit.movement.jumpMP > 0 ? lookupTmm(unit.movement.jumpMP) + TMM_JUMP_BONUS : 0,
    armor: {
      torso,
      rear,
      head,
      leftArm: convertArmLegArmor(a.LA),
      rightArm: convertArmLegArmor(a.RA),
      leftLeg: convertArmLegArmor(a.LL),
      rightLeg: convertArmLegArmor(a.RL),
      // Tripod center leg only (omitted otherwise).
      ...(a.CL !== undefined ? { centerLeg: convertArmLegArmor(a.CL) } : {}),
    },
    structure,
    armorType: unit.armorType,
    heatDissipation,
    weapons,
    tics: groupIntoTics(weapons),
    equipment: [...constructionEquipment(unit), ...buildEquipment([...(unit.critSlots ?? []), ...divertedEquipment])],
    melee,
    warnings,
    sourceFile: unit.sourceFile,
  };
}
