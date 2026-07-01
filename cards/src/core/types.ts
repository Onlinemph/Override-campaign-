/**
 * Core domain types for mtf2override.
 *
 * This module is PURE: no Node, browser, or filesystem imports. It must compile
 * and run unchanged in both Node and a browser bundle.
 *
 * The `Unit` type is the contract between the parser (mtf text -> Unit) and the
 * conversion math (Unit -> OverrideCard). Keeping it free of conversion concerns
 * is what lets either layer be swapped or extended independently.
 */

/** Tech base, normalized from the many MTF spellings. */
export type TechBase = "IS" | "Clan";

/** Heat-sink technology. Doubles dissipate 2 heat each; singles 1. */
export type HeatSinkType = "single" | "double";

/**
 * Canonical 'Mech location codes used as keys for armor and structure.
 *
 * Front locations:
 *   HD head, CT/LT/RT torsos, LA/RA arms, LL/RL legs.
 * Rear torso locations (armor only — internal structure is shared with the
 * front torso, so there are no rear structure entries):
 *   CTR center-torso rear, LTR left-torso rear, RTR right-torso rear.
 *
 * NOTE on MTF variants: different MegaMek versions spell the rear lines
 * differently (e.g. `RTC`/`CTR`, `RTL`/`LTR`). The parser normalizes all of
 * them onto these three canonical rear keys.
 */
export type MechLocation =
  | "HD"
  | "CT"
  | "LT"
  | "RT"
  | "LA"
  | "RA"
  | "LL"
  | "RL"
  | "CL" // center leg (Tripod only)
  | "CTR"
  | "LTR"
  | "RTR";

/** Front locations that carry internal structure. CL is Tripod-only. */
export type StructureLocation = "HD" | "CT" | "LT" | "RT" | "LA" | "RA" | "LL" | "RL" | "CL";

/** A single mounted weapon as listed in the MTF weapons block. */
export interface Weapon {
  /** Weapon name exactly as written in the MTF (e.g. "Medium Laser"). */
  name: string;
  /** Normalized location code the weapon is mounted in. */
  location: MechLocation;
  /** Original location text from the file (e.g. "Center Torso"), for diagnostics. */
  rawLocation: string;
  /** True if the weapon was flagged rear-mounted, e.g. "Medium Laser (R)". */
  rearMounted: boolean;
}

/**
 * One occupied critical slot, parsed from the per-location crit blocks (which
 * the `Weapons:` block does not cover). Multi-slot items appear once per slot;
 * "-Empty-" slots are skipped. Used to surface ammo and notable equipment.
 */
export interface CritSlot {
  /** Slot contents exactly as written (e.g. "IS Ammo AC/20", "ISGuardianECM"). */
  name: string;
  /** Normalized location code. */
  location: MechLocation;
  /** Original location header text (e.g. "Right Torso"). */
  rawLocation: string;
}

/** Movement profile. Override carries these straight to the card at 1:1. */
export interface Movement {
  /** Walk MP as listed in the MTF. */
  walkMP: number;
  /** Run MP. Explicit if present in the file, otherwise ceil(walk * 1.5). */
  runMP: number;
  /** Jump MP (0 if none). */
  jumpMP: number;
  /** True when runMP was derived rather than read from the file. */
  runDerived: boolean;
}

/** Heat-sink loadout. */
export interface HeatSinks {
  /** Number of heat sinks. */
  count: number;
  /** single | double. */
  type: HeatSinkType;
}

/** Engine description parsed from the MTF `Engine:` line. */
export interface Engine {
  /** Engine rating (the leading number, e.g. 160). */
  rating: number;
  /** Engine type label, e.g. "Fusion", "XL", "Light", "XXL". */
  type: string;
  /** True for Clan-tech engines (XL/XXL survivability differs from IS). */
  clan?: boolean;
}

/**
 * A fully-parsed BattleMech. Physical facts only — no derived game stats.
 *
 * `armor` and `structure` are partial: a given chassis only populates the
 * locations it actually has. Internal structure is NOT present in MTF text; the
 * parser derives it from the standard internal-structure-by-tonnage table
 * (see constants.ts) keyed on `mass`.
 */
export interface Unit {
  chassis: string;
  model: string;
  /** Tonnage. */
  mass: number;
  techBase: TechBase;
  /** Config string from the MTF (e.g. "Biped", "Quad"). */
  config: string;
  engine: Engine;
  movement: Movement;
  heatSinks: HeatSinks;
  /** Armor type from the bare `Armor:` line (e.g. "Standard", "Stealth(...)"). */
  armorType?: string;
  /** Internal-structure type from the `Structure:` line (e.g. "IS Reinforced", "Endo Steel"). */
  structureType?: string;
  /** Cockpit type from the `Cockpit:` line (e.g. "Torso-Mounted Cockpit", "Small Cockpit"). */
  cockpitType?: string;
  /** Gyro type from the `Gyro:` line (e.g. "Compact Gyro", "XL Gyro", "Heavy Duty Gyro"). */
  gyroType?: string;
  /** Armor points per location, including rear torso locations. */
  armor: Partial<Record<MechLocation, number>>;
  /** Internal structure points per front location, derived from tonnage. */
  structure: Partial<Record<StructureLocation, number>>;
  weapons: Weapon[];
  /**
   * Occupied critical slots from the per-location crit blocks (ammo, CASE,
   * electronics, etc.). Optional: many hand-written MTFs omit crit blocks.
   */
  critSlots?: CritSlot[];
  /** Source filename, populated by the CLI for error messages and output naming. */
  sourceFile?: string;
}

// ---------------------------------------------------------------------------
// Conversion output — the Override record-card stats produced by convert.ts.
// ---------------------------------------------------------------------------

/**
 * How a weapon's damage is rolled on the Override card.
 *   - direct:    flat damage (base === max, no dice). Lasers, ACs, Gauss, etc.
 *   - variable:  flat but range-dependent, printed `short|med|long`. SNPPC, Heavy Gauss.
 *   - missile:   rolls M dice; prints `base+M{mDice} (max)`. LRM/SRM/MRM/RL.
 *   - rvmissile: range-varying missile rack; per-bracket base PLUS M dice, printed
 *                `short|med|long+M{mDice} (max)`. MML, ATM/iATM.
 *   - cluster:   rolls C dice; prints `base+C{cDice}`. LB-X, HAG, Silver Bullet.
 */
export type DamageKind = "direct" | "variable" | "missile" | "rvmissile" | "cluster";

/**
 * Override damage profile. Direct-fire weapons deal flat damage (base === max,
 * mDice 0, cDice []). Missile racks roll M dice (`base+M{mDice} (max)`). Cluster
 * weapons roll C dice (`base+C{cDice}`), where base + cDice === max. Variable
 * weapons print per-range damage (`byRange` = [short, med, long]).
 */
export interface DamageProfile {
  /** Which dice mechanic this weapon uses. */
  kind: DamageKind;
  /** Guaranteed minimum damage. floor(rackTW/10), min 1 for missile/cluster; === max for direct. */
  base: number;
  /** Number of M (missile) dice = ceil(rackTW / 10). 0 unless kind === "missile". */
  mDice: number;
  /**
   * C (cluster) dice = max − base. Empty unless kind === "cluster". One entry
   * for a range-independent cluster (LB-X); three entries [short, med, long]
   * for a range-varying cluster (HAG), each one lower than the last.
   */
  cDice: number[];
  /** Per-range damage [short, med, long], each ceil(TW/3). Empty unless kind === "variable". */
  byRange: number[];
  /** Maximum damage. For variable weapons this is the short-range value. */
  max: number;
  /** Heat-causing dice applied to the TARGET (plasma weapons), printed "+H{n}". 0/undefined for normal weapons. */
  heatDamage?: number;
}

/**
 * Total Warfare range profile (in hexes) used to derive Override range
 * brackets. Per page 43, the bracket math only ever reads min, medium, and
 * long range — the short-range value is not used — so only those are stored.
 */
export interface WeaponRange {
  /** Minimum range (TW). 0 if the weapon has none. Drives PB and S. */
  min: number;
  /** Medium-bracket range value (TW). Drives M. */
  medium: number;
  /** Long-bracket range value (TW). Drives L and X. */
  long: number;
  /** Inherent flat to-hit modifier added to every applicable bracket (e.g. MRM +1). Default 0. */
  toHitMod?: number;
}

/**
 * Override range-bracket to-hit modifiers (page 43). `null` means the bracket
 * does not apply to this weapon and prints as "–".
 */
export interface RangeBrackets {
  /** Point Blank. */
  pb: number | null;
  /** Short. */
  s: number | null;
  /** Medium. */
  m: number | null;
  /** Long. */
  l: number | null;
  /** Extreme. */
  x: number | null;
}

/** A weapon as it appears on the Override card. */
export interface CardWeapon {
  /** Weapon name from the MTF. */
  name: string;
  /** Normalized location code. */
  location: MechLocation;
  /** Original location/facing string from the source (e.g. "Left Arm", "nose").
   * Used by the TIC editor as the per-facing grouping key for vehicles/aero. */
  rawLocation?: string;
  /** Rear-mounted flag carried from parsing. */
  rearMounted: boolean;
  /** Total Warfare damage looked up for this weapon (0 if unknown). */
  twDamage: number;
  /** Converted Override damage (the MAX): roundUp(twDamage / 3). v1 = one weapon per TIC. */
  damage: number;
  /** Full damage profile (base / mDice / max). */
  profile: DamageProfile;
  /** Printed damage string: `base+M{mDice} (max)` for missiles, else flat `max`. */
  damageText: string;
  /** Range-bracket modifiers (page 43), or null when the weapon has no range data yet. */
  range: RangeBrackets | null;
  /** Printed range row "PB S M L X" (e.g. "+4 +2 +0 +2 +4"), or null when range data is missing. */
  rangeText: string | null;
  /** True when the weapon name was not found in the TW damage table. */
  unknown: boolean;
}

/**
 * A TIC (Targeting & Interface Circuit) — one or more weapons fired as a single
 * attack. Auto-grouping combines identical weapons in the same location/facing,
 * summing their TW damage before the ÷3, subject to the page-41 caps (base ≤ 5,
 * max ≤ 14). A single weapon is always its own legal TIC even if it exceeds the
 * cap (e.g. Heavy Gauss). Users may later re-group freely within those caps.
 */
export interface Tic {
  /** Member weapons (≥1). When count > 1 they share name, location, and facing. */
  weapons: CardWeapon[];
  /** Display label, e.g. "Medium Laser" or "3x Medium Laser". */
  label: string;
  location: MechLocation;
  rearMounted: boolean;
  /** Number of weapons combined. */
  count: number;
  /** Combined damage profile (summed TW). */
  profile: DamageProfile;
  /** Printed combined damage string. */
  damageText: string;
  /** Range brackets (shared by the identical members), or null if unknown. */
  range: RangeBrackets | null;
  rangeText: string | null;
  /** Display-only heat override (web quirk application, e.g. cooling jackets);
   * when set, the card shows this instead of the computed ticHeat. */
  heatOverride?: number;
  /** Display-only: set by the web layer when a Targeting Computer is aiding this
   * (direct-fire) weapon, so the card can mark it "(TC)". */
  tc?: boolean;
}

/**
 * Notable equipment surfaced on the card: ammo (with bin count) and important
 * gear (CASE, ECM, probes, etc.), each with its location. Mundane crit items
 * (actuators, structure, heat sinks, the weapons themselves) are excluded.
 */
export interface CardEquipment {
  /** Clean display label, e.g. "AC/20 Ammo" or "ECM". */
  label: string;
  /** Location code. */
  location: MechLocation;
  /** "ammo" for ammunition bins, "equipment" for everything else. */
  category: "ammo" | "equipment";
  /** Number of bins/slots (ammo and jump jets count; other gear is 1). */
  count: number;
  /** Total rounds carried for an ammo line (sum across its bins), when the
   * shots-per-ton is known. Used by the play-mode ammo counter; omitted for
   * equipment and for ammo types without a canonical per-ton count. */
  shots?: number;
  /** True for body-wide systems (Stealth Armor, signature gear) shown once, no location. */
  global?: boolean;
}

/** Per-section armor on the Override card. */
export interface CardArmor {
  /** (CT + LT + RT) / 6, round nearest. */
  torso: number;
  /** (CTr + LTr + RTr) / 6, round nearest. */
  rear: number;
  /** Head-armor bracket lookup on head TW. */
  head: number;
  /** TW / 3, round nearest, min 1 (0 if location absent). */
  leftArm: number;
  rightArm: number;
  leftLeg: number;
  rightLeg: number;
  /** Center-leg armor (Tripod 'Mechs only); omitted otherwise. */
  centerLeg?: number;
}

/**
 * Auto-generated melee damage, derived from tonnage and printed as a combined
 * "Punch / Kick" row. Punch = ceil(ceil(mass/10)/3), Kick = ceil(ceil(mass/5)/3).
 */
export interface MeleeProfile {
  punch: number;
  kick: number;
}

/** Per-section internal structure on the Override card. Each = IS / 3, round nearest, min 1. */
export interface CardStructure {
  /** Torso structure, from center-torso internal structure. */
  torso: number;
  head: number;
  leftArm: number;
  rightArm: number;
  leftLeg: number;
  rightLeg: number;
  /** Center-leg structure (Tripod 'Mechs only); omitted otherwise. */
  centerLeg?: number;
}

// ---------------------------------------------------------------------------
// Battle Armor (BLK). A separate physical model and card — BA squads share
// almost nothing with 'Mechs (no per-limb armor/structure, no heat sinks, no
// punch/kick), but the weapon -> damage/range/TIC engine and the equipment
// surfacing are reused unchanged.
// ---------------------------------------------------------------------------

/** Discriminates the two unit families the tool can currently produce. */
export type UnitKind = "mech" | "battlearmor";

/** Battle-armor weight class, from the BLK `<weightclass>` index (0..4). */
export type BAWeightClass = "PA(L)" | "Light" | "Medium" | "Heavy" | "Assault";

/**
 * One weapon/equipment entry parsed from a BLK equipment block. The trailing
 * `:LOC` mount tag (manipulator/body) is split off into `mount`. `copies` is
 * how many of this item the whole SQUAD fields: an item listed in a squad-wide
 * block is carried by every trooper (copies = trooper count), while an item in
 * a per-trooper block is a single mount (copies = 1).
 */
export interface BlkMount {
  /** Item name exactly as written, tech prefix preserved, `:LOC` stripped. */
  name: string;
  /** Mount/manipulator code after the colon (e.g. "LA", "Body"), or "". */
  mount: string;
  /** How many the squad fields in total. */
  copies: number;
}

/**
 * A fully-parsed Battle Armor squad from a BLK file. Physical facts only — no
 * derived game stats (mirrors how `Unit` relates to `OverrideCard`).
 */
export interface BattleArmorUnit {
  kind: "battlearmor";
  chassis: string;
  model: string;
  techBase: TechBase;
  /** Squad size (number of suits/troopers). */
  troopers: number;
  weightClass: BAWeightClass;
  /** Ground MP (BLK `cruiseMP`/`walkMP`). */
  walkMP: number;
  /** Jump / VTOL / UMU MP — the secondary movement mode, 0 if none. */
  jumpMP: number;
  /** Raw `motion_type` label (e.g. "Jump", "Leg", "VTOL"). */
  motionType: string;
  /** Armor points per trooper (BLK `armor`). */
  armorPerTrooper: number;
  /** Chassis type: "biped" | "quad". */
  chassisType: string;
  /** Weapon + equipment mounts, squad totals folded into `copies`. */
  mounts: BlkMount[];
  sourceFile?: string;
}

/**
 * One distinct weapon in a Battle Armor squad's per-trooper loadout, with its
 * damage read off a row per surviving trooper count.
 *
 * Unlike a 'Mech TIC (identical weapons grouped under the page-41 caps), BA
 * troopers each fire their own copy independently, so a weapon's guaranteed base
 * and any M/C dice scale linearly with the number of suits still standing, while
 * the printed max stays ceil(totalTW / 3). The card therefore shows a small
 * table — surviving troopers down the side, weapons across the top — instead of
 * a single grouped value.
 */
export interface BAFirepower {
  /** Display label, e.g. "ER Small Laser" or "2x SRM 2" (per-trooper count prefixed). */
  label: string;
  /** How many of this weapon each trooper carries. */
  perTrooper: number;
  /** True when the weapon name was not found in the TW damage table. */
  unknown: boolean;
  /** Range-bracket modifiers (shared by every copy), or null when unknown. */
  range: RangeBrackets | null;
  /** Printed range row "PB S M L X", or null when range data is missing. */
  rangeText: string | null;
  /**
   * Printed squad damage by surviving trooper count. Index i is (i + 1) troopers
   * firing, so `byTrooper[troopers - 1]` is the full squad and `byTrooper[0]` is
   * a lone survivor.
   */
  byTrooper: string[];
}

/**
 * Converted Override record-card statistics for a Battle Armor squad.
 *
 * The armor/movement/TMM math MIRRORS the 'Mech rules (same divisors and TMM
 * table) as a best-effort starting point — every such field is marked with a
 * TODO and should be validated against the DFA generator's BA output.
 */
export interface BattleArmorCard {
  kind: "battlearmor";
  /** "Chassis Model". */
  name: string;
  chassis: string;
  model: string;
  techBase: TechBase;
  troopers: number;
  weightClass: BAWeightClass;
  /** Printed move string, e.g. "1/3 (J)" (ground/jump). */
  move: string;
  walkMP: number;
  jumpMP: number;
  motionType: string;
  /** Base TMM (mirrored from the 'Mech run-MP table — best-effort). */
  tmm: number;
  /** Base TMM + jump bonus (meaningful only when jumpMP > 0). */
  tmmJump: number;
  /** Raw armor points per trooper, straight from the BLK. */
  armorPerTrooper: number;
  /** Override armor per trooper (best-effort: mirrors 'Mech arm/leg = TW/3). */
  armor: number;
  /**
   * Per-trooper "health": the final hit a suit can take once its armor is gone
   * (the trooper's single internal/structure point). Shown as a red hex after
   * the armor hexes, so an Elemental reads 3 armor + 1 health = 4 total.
   */
  health: number;
  /** Squad weapons (per-trooper loadout replicated across the squad). */
  weapons: CardWeapon[];
  /** Weapons auto-grouped into TICs (kept for reference; BA cards show `firepower`). */
  tics: Tic[];
  /**
   * Per-trooper firepower: each distinct weapon's damage scaled by surviving
   * trooper count. This is what the BA card prints — BA does not use TICs.
   */
  firepower: BAFirepower[];
  /** Notable equipment with mounts (ammo, electronics). */
  equipment: CardEquipment[];
  /** Whether the squad can make anti-'Mech attacks (best-effort). */
  antiMech: boolean;
  /**
   * Anti-infantry damage strings by surviving trooper count. Each suit deals
   * 1d6 independently, so index i = (i+1) troopers → `"(i+1)d6"`. The value
   * is a display string only — "3d6", "2d6", etc. — produced by buildFirepower.
   */
  antiInfantryByTrooper: string[];
  warnings: string[];
  sourceFile?: string;
}

// ---------------------------------------------------------------------------
// Combat Vehicles (BLK Tank). Armor is by FACING (front/right/left/rear and an
// optional turret) rather than per-limb; there is no melee, head, or internal
// structure table. The weapon -> damage/range/TIC engine is reused per facing.
// ---------------------------------------------------------------------------

/**
 * A vehicle armor/equipment facing. "body" holds non-facing gear; "rotor" is the
 * VTOL main rotor (its own fragile location).
 */
export type VehicleFacing = "front" | "right" | "left" | "rear" | "turret" | "rotor" | "body";

/** One weapon/equipment entry from a BLK facing block (e.g. <Turret Equipment>). */
export interface VehicleMount {
  /** Item name exactly as written. */
  name: string;
  /** Which facing block it came from. */
  facing: VehicleFacing;
}

/** Armor points per facing, straight from the BLK `<armor>` block. */
export interface VehicleArmorRaw {
  front: number;
  right: number;
  left: number;
  rear: number;
  /** Present only when the vehicle has a turret. */
  turret?: number;
  /** Present only on VTOLs — the main rotor's armor. */
  rotor?: number;
}

/** A fully-parsed combat vehicle from a BLK Tank/VTOL file. Physical facts only. */
export interface VehicleUnit {
  kind: "vehicle";
  chassis: string;
  model: string;
  techBase: TechBase;
  /** Tonnage. */
  tonnage: number;
  /** Movement mode: "Tracked" | "Wheeled" | "Hover" | "VTOL" | "Naval" | … */
  motionType: string;
  /** Cruise MP (≈ walk). */
  cruiseMP: number;
  /** Flank MP (≈ run): explicit if present, else ceil(cruise * 1.5). */
  flankMP: number;
  armor: VehicleArmorRaw;
  /** Armor type (for the pip shape); undefined = Standard/default. */
  armorType?: string;
  hasTurret: boolean;
  /** True for VTOLs — adds the rotor location. */
  hasRotor: boolean;
  /** True for Support vehicles (SupportTank/LargeSupportTank/SupportVTOL). */
  support?: boolean;
  mounts: VehicleMount[];
  sourceFile?: string;
}

/** One weapon row on the vehicle card: a TIC scoped to a facing. */
export interface VehicleWeaponRow {
  /** Abbreviated label (count + Clan prefix + "(RF)"). */
  label: string;
  /** Display facing: "Front" | "Turret" | "Right" | "Left" | "Rear". */
  facing: string;
  /** Printed damage string. */
  damageText: string;
  /** Override heat (ceil sum TW heat / 5). */
  heat: number;
  range: RangeBrackets | null;
  rangeText: string | null;
  unknown: boolean;
  /** Display-only: set by the web layer when a Targeting Computer aids this
   * (direct-fire) weapon, so the card can mark it "(TC)". */
  tc?: boolean;
}

/** Per-facing Override armor on the vehicle card. */
export interface VehicleCardArmor {
  front: number;
  right: number;
  left: number;
  rear: number;
  turret?: number;
  /** VTOL rotor armor (present only on VTOLs). */
  rotor?: number;
}

/** Notable vehicle equipment (ammo/gear) with its facing (e.g. "BD" body). */
export interface VehicleEquipment {
  label: string;
  /** Short facing code: "BD" | "FR" | "TU" | "RS" | "LS" | "RR". */
  facing: string;
  category: "ammo" | "equipment";
  count: number;
}

/** Converted Override record-card statistics for a combat vehicle. */
export interface VehicleCard {
  kind: "vehicle";
  name: string;
  chassis: string;
  model: string;
  techBase: TechBase;
  tonnage: number;
  motionType: string;
  /** Printed move string, e.g. "4 / 6t" (cruise/flank + motion letter). */
  move: string;
  cruiseMP: number;
  flankMP: number;
  /** Base TMM (mirrored from the 'Mech flank-MP table); card prints `tmm / tmm+1`. */
  tmm: number;
  /** Per-facing Override armor (best-effort: TW / 5). */
  armor: VehicleCardArmor;
  /** Armor type (for the pip shape); undefined = Standard/default. */
  armorType?: string;
  /** Internal structure per facing (uniform, best-effort from tonnage). */
  structure: number;
  hasTurret: boolean;
  /** True for VTOLs — the card shows a rotor location. */
  hasRotor: boolean;
  /** True for Support vehicles — the card labels them "Support …". */
  support?: boolean;
  weapons: VehicleWeaponRow[];
  /** Raw per-arc weapons (rawLocation = facing) — source for the manual TIC editor. */
  weaponMounts: CardWeapon[];
  /** Auto-grouped TICs; the weapons rows above are derived from these. */
  tics: Tic[];
  equipment: VehicleEquipment[];
  warnings: string[];
  sourceFile?: string;
}

// ---------------------------------------------------------------------------
// Aerospace & Conventional Fighters (BLK Aero / ConvFighter). Armor is by four
// facings (nose / left wing / right wing / aft); movement is thrust-based; there
// is no turret or rotor. The weapon -> damage/range/TIC engine is reused per
// facing, and weapon rows / equipment reuse the vehicle card's row + equipment
// shapes (VehicleWeaponRow / VehicleEquipment).
// ---------------------------------------------------------------------------

/** A fighter armor/equipment facing. "fuselage" holds non-facing gear/ammo. */
export type FighterFacing =
  | "nose"
  | "leftWing"
  | "rightWing"
  | "aft"
  | "wings"
  | "fuselage";

/** One weapon/equipment entry from a BLK fighter facing block (e.g. <Nose Equipment>). */
export interface FighterMount {
  /** Item name exactly as written. */
  name: string;
  /** Which facing block it came from. */
  facing: FighterFacing;
  /** True if flagged rear-firing with a leading "(R)" marker (e.g. wing weapons aimed aft). */
  rear?: boolean;
}

/** Armor points per facing, from the BLK `<armor>` block (nose, right, left, aft). */
export interface FighterArmorRaw {
  nose: number;
  rightWing: number;
  leftWing: number;
  aft: number;
}

/** A fully-parsed fighter from a BLK Aero/ConvFighter file. Physical facts only. */
export interface FighterUnit {
  kind: "fighter";
  chassis: string;
  model: string;
  techBase: TechBase;
  /** Tonnage. */
  tonnage: number;
  /** True for conventional (atmospheric) fighters; false for aerospace. */
  conventional: boolean;
  /** Airframe: "Aerodyne" | "Spheroid". */
  motionType: string;
  /** Safe Thrust (≈ walk/cruise). */
  safeThrust: number;
  /** Max Thrust (≈ run): explicit if present, else ceil(safe * 1.5). */
  maxThrust: number;
  /** Heat-sink count from `<heatsinks>` (0 if absent). */
  heatSinkCount: number;
  /** Heat-sink tech from `<sink_type>`: 1 = double, 0 = single. */
  heatSinkType: HeatSinkType;
  /** Fuel points from `<fuel>` (0 if absent). */
  fuel: number;
  armor: FighterArmorRaw;
  /** Armor type (for the pip shape); undefined = Standard/default. */
  armorType?: string;
  mounts: FighterMount[];
  sourceFile?: string;
}

/** Per-facing Override armor on the fighter card. */
export interface FighterCardArmor {
  nose: number;
  rightWing: number;
  leftWing: number;
  aft: number;
}

/** Converted Override record-card statistics for an aerospace/conventional fighter. */
export interface FighterCard {
  kind: "fighter";
  name: string;
  chassis: string;
  model: string;
  techBase: TechBase;
  tonnage: number;
  /** True for conventional fighters (shown as "Conventional Fighter" vs "Aerospace"). */
  conventional: boolean;
  motionType: string;
  /** Printed thrust string, e.g. "6 / 9" (safe / max). */
  move: string;
  safeThrust: number;
  maxThrust: number;
  /** Printed TMM: a SINGLE number, the higher (sprint) value of the 'Mech pair. */
  tmm: number;
  /**
   * Override heat sinks: dissipation / 5, round nearest (doubles sink 2 each) —
   * the same scale as the 'Mech card. 0 for conventional fighters, which do not
   * track heat (the card omits the Sinks field and heat scale).
   */
  sinks: number;
  /** Damage Threshold: (nose + aft + one wing) TW armor / 30, round nearest. */
  dthr: number;
  /** Per-facing Override armor (TW / 4). */
  armor: FighterCardArmor;
  /** Armor type (for the pip shape); undefined = Standard/default. */
  armorType?: string;
  /** Single airframe-wide Structural Integrity (best-effort from tonnage). */
  structure: number;
  /** Fuel points (from BLK <fuel>). Fuel tonnage = fuel / (conventional ? 160 : 80). */
  fuel: number;
  weapons: VehicleWeaponRow[];
  /** Raw per-arc weapons (rawLocation = facing) — source for the manual TIC editor. */
  weaponMounts: CardWeapon[];
  /** Auto-grouped TICs; the weapons rows above are derived from these. */
  tics: Tic[];
  equipment: VehicleEquipment[];
  warnings: string[];
  sourceFile?: string;
}

// ---------------------------------------------------------------------------
// Conventional Infantry (BLK Infantry). A platoon is N troopers (squad_size x
// squadn) carrying a primary small arm (plus an optional secondary), with a
// movement mode and optional anti-'Mech ability and towed field guns. Small-arms
// platoon damage needs the TW infantry-weapon table (pending DFA calibration);
// field guns are standard weapons converted by the shared engine.
// ---------------------------------------------------------------------------

/** A fully-parsed conventional infantry platoon from a BLK file. Physical facts only. */
export interface InfantryUnit {
  kind: "infantry";
  chassis: string;
  model: string;
  techBase: TechBase;
  /** Total troopers = squad size x squad count. */
  troopers: number;
  squadSize: number;
  squadCount: number;
  /** Raw `motion_type` (e.g. "Leg", "Jump", "Motorized", "Beast:Horse"). */
  motionType: string;
  /** Primary weapon name (every trooper). */
  primaryWeapon: string;
  /** Secondary weapon name, if any. */
  secondaryWeapon?: string;
  /** Secondary weapons per squad (BLK `secondn`). */
  secondaryPerSquad: number;
  /** True when the platoon can make anti-'Mech (leg/swarm) attacks. */
  antiMek: boolean;
  /** Towed field-gun weapon names (standard 'Mech-scale weapons). */
  fieldGuns: string[];
  sourceFile?: string;
}

/** One band of the infantry damage-degradation track (a run of equal damage). */
export interface InfantryDamageBreak {
  /** Highest surviving-SQUAD count in this band. */
  from: number;
  /** Lowest surviving-SQUAD count in this band. */
  to: number;
  /** Cluster damage while the number of surviving squads falls within [to, from]. */
  damage: number[];
}

/** Converted Override record-card statistics for an infantry platoon. */
export interface InfantryCard {
  kind: "infantry";
  name: string;
  chassis: string;
  model: string;
  techBase: TechBase;
  troopers: number;
  /** Display movement label (e.g. "Foot", "Jump", "Motorized", "Beast"). */
  motionLabel: string;
  /** Printed move string, e.g. "3/5" (walk/run) or "3 (J)" (jump MP). */
  move: string;
  /** Base TMM (numeric, for CSV); see `tmmText` for the printed value. */
  tmm: number;
  /** Printed TMM, e.g. "1/2" (base/sprint) for ground or "1" for jump. */
  tmmText: string;
  antiMek: boolean;
  /** Troopers per squad (BLK `squad_size`). */
  squadSize: number;
  /** Number of squads in the platoon (BLK `squadn`). */
  squadCount: number;
  /**
   * Small-arms platoon damage at FULL strength as 2-point clusters (e.g.
   * [2,2,2,1] = 7). Empty when the primary weapon is not yet in the per-trooper
   * damage table. Equal to the last entry of `damageBySquads`.
   */
  damage: number[];
  /**
   * Per-squad damage-degradation track: index i = the platoon's small-arms
   * damage when (i+1) squads survive (full strength last). The official system
   * recalculates as whole squads are eliminated; the card renders this as a
   * "bodies remaining" marker grouped by squad. Empty when unscored.
   */
  damageBySquads: number[][];
  /**
   * Compressed degradation breakpoints (full strength first): each segment is a
   * surviving-SQUAD band that yields the same damage. Derived from
   * `damageBySquads`; convenient for printing a legend.
   */
  damageBreaks: InfantryDamageBreak[];
  /** Primary small-arms range brackets (PB/S/M/L/X to-hit mods), or null when unscored. */
  range: RangeBrackets | null;
  /** Printed range row "PB S M L X", or null. */
  rangeText: string | null;
  /** Primary weapon max range in hexes (TW), or null when unscored. */
  primaryRangeHexes: number | null;
  /** Secondary weapon max range in hexes (TW), if a scored secondary is present. */
  secondaryRangeHexes?: number | null;
  /** Cleaned primary weapon display name. */
  primaryWeapon: string;
  /** Cleaned secondary weapon display name, if any. */
  secondaryWeapon?: string;
  /** Total secondary weapons across the platoon. */
  secondaryCount: number;
  /** Towed field guns, converted as standard weapon rows (facing left blank). */
  fieldGuns: VehicleWeaponRow[];
  warnings: string[];
  sourceFile?: string;
}

/** Converted Override record-card statistics for one unit. */
export interface OverrideCard {
  /** "Chassis Model". */
  name: string;
  chassis: string;
  model: string;
  mass: number;
  techBase: TechBase;
  /** Raw config string from the MTF (e.g. "Biped", "Biped Omnimech"). */
  config: string;
  /** Printed move string, e.g. "8/12" or "5/8 (J)". */
  move: string;
  walkMove: number;
  runMove: number;
  jump: number;
  /** Base TMM (what the card prints). */
  tmm: number;
  /** Base TMM + sprint bonus (exposed, not printed). */
  tmmSprint: number;
  /** Base TMM + jump bonus (exposed; meaningful only when jump > 0). */
  tmmJump: number;
  armor: CardArmor;
  /** Per-section structure: IS / 3, round nearest, min 1 (torso from CT). */
  structure: CardStructure;
  /** Armor type from the MTF `Armor:` line (e.g. "Ferro-Fibrous", "Stealth"),
   * used to pick the armor-pip shape. */
  armorType?: string;
  /** Display-only (web, play mode): leg-actuator hits, each −2 walk/run, −1 TMM. */
  legHits?: number;
  /** Display-only (web, play mode): current heat level. 1+ → −2 Move / −1 TMM,
   * 2+ → +1 ranged attack modifier (Override heat scale). */
  heat?: number;
  /** Total dissipated per round / 5, round nearest. */
  heatDissipation: number;
  /** Individual converted weapons (ungrouped), kept for reference/editing. */
  weapons: CardWeapon[];
  /** Weapons auto-grouped into TICs (what the card fires). */
  tics: Tic[];
  /** Notable equipment with locations (ammo, CASE, electronics). */
  equipment: CardEquipment[];
  /** Auto-generated Punch / Kick damage from tonnage. */
  melee: MeleeProfile;
  /** Non-fatal notes (e.g. weapons missing from the TW damage table). */
  warnings: string[];
  sourceFile?: string;
}

// ---------------------------------------------------------------------------
// ProtoMech (BLK). 'Mech-like but small (2-15t): a single Legs location (no
// separate L/R), a "Main Gun" location on some designs, and a Frenzy melee
// attack in place of Punch/Kick. Hit locations mirror the 'Mech table except a
// 3 or 11 is a MISS. Conversion mirrors the 'Mech rules (÷3).
// ---------------------------------------------------------------------------

/** ProtoMech locations (Legs is a single combined block; Main Gun is optional). */
export type ProtoLoc = "head" | "torso" | "rightArm" | "leftArm" | "legs" | "mainGun";

/** One mounted weapon/equipment item and the ProtoMech location it sits in. */
export interface ProtoMount {
  name: string;
  loc: ProtoLoc;
}

/** Raw per-location armor points from the BLK `<armor>` block. */
export interface ProtoArmorRaw {
  head: number;
  torso: number;
  rightArm: number;
  leftArm: number;
  legs: number;
  mainGun: number;
}

/** A fully-parsed ProtoMech — physical facts only. */
export interface ProtoMechUnit {
  kind: "protomech";
  chassis: string;
  model: string;
  techBase: TechBase;
  /** Tonnage (2-15). */
  tonnage: number;
  /** Raw `motion_type` ("Biped", "Quad", "WiGE"/Glider). */
  motionType: string;
  /** Walk/cruise MP. */
  walkMP: number;
  /** Jump MP (0 if none). */
  jumpMP: number;
  /** True when the design has arms (arm armor or arm-mounted gear). */
  hasArms: boolean;
  /** True when the design carries a torso-mounted Main Gun (6th armor value). */
  hasMainGun: boolean;
  armor: ProtoArmorRaw;
  /** Armor type (for the pip shape); undefined = Standard/default. */
  armorType?: string;
  mounts: ProtoMount[];
  sourceFile?: string;
}

/** Per-location armor/structure on the ProtoMech card (Main Gun optional). */
export interface ProtoCardArmor {
  head: number;
  torso: number;
  rightArm: number;
  leftArm: number;
  legs: number;
  mainGun?: number;
}

/** Converted Override record-card statistics for a ProtoMech. */
export interface ProtoMechCard {
  kind: "protomech";
  name: string;
  chassis: string;
  model: string;
  techBase: TechBase;
  tonnage: number;
  /** Display motion label ("Biped", "Quad", "Glider"). */
  motionLabel: string;
  /** Printed move string, e.g. "5 / 8 / 5j" (walk / run / jump). */
  move: string;
  /** Base TMM (numeric); see `tmmText` for the printed value. */
  tmm: number;
  /** Printed TMM, e.g. "2 / 3 / 3" (walk / sprint / jump). */
  tmmText: string;
  hasArms: boolean;
  hasMainGun: boolean;
  /** Per-location armor (TW / 3, round nearest, min 1; 0 if absent). */
  armor: ProtoCardArmor;
  /** Armor type (for the pip shape); undefined = Standard/default. */
  armorType?: string;
  /** Per-location internal structure (IS / 3, round nearest, min 1). */
  structure: ProtoCardArmor;
  /** Weapon rows (TICs grouped per location; `facing` holds the Loc code). */
  weapons: VehicleWeaponRow[];
  /** Raw per-arc weapons (rawLocation = facing) — source for the manual TIC editor. */
  weaponMounts: CardWeapon[];
  /** Auto-grouped TICs; the weapons rows above are derived from these. */
  tics: Tic[];
  /** Frenzy melee damage by tonnage (1 / 2 / 3); replaces Punch/Kick. */
  frenzy: number;
  equipment: VehicleEquipment[];
  warnings: string[];
  sourceFile?: string;
}

// ---------------------------------------------------------------------------
// DropShip (BLK). Converted with the aerospace-fighter rules: armor = TW/4,
// Sinks = dissipation/5, DThr = (nose + aft + one side)/30, TMM = single higher
// value on max thrust. Four firing arcs (Nose / Left Side / Right Side / Aft)
// plus a Hull bay for non-firing gear; SI comes straight from the BLK
// <structural_integrity> (÷3 to the card scale, best-effort).
// ---------------------------------------------------------------------------

/** DropShip firing arcs (hull = non-firing internal mounts). */
export type DropshipFacing =
  | "nose"
  | "leftSide"
  | "rightSide"
  | "aft"
  | "hull"
  // WarShip-only firing arcs (DropShips use the four above):
  | "foreLeft"
  | "foreRight"
  | "aftLeft"
  | "aftRight"
  | "leftBroad"
  | "rightBroad";

/** One mounted weapon/equipment item and the arc it fires from. */
export interface DropshipMount {
  name: string;
  facing: DropshipFacing;
  /** Weapon-bay id (MegaMek "(B)" groups). Same id = fires as one bay. Undefined
   * on markerless BLKs, which fall back to auto-grouping identical weapons. */
  bay?: number;
  /** True if flagged rear-firing with a leading "(R)" — on a spheroid side arc
   * this is the AFT sub-arc (so each side splits into a fore and an aft arc). */
  rear?: boolean;
}

/**
 * Per-arc armor. DropShips carry four facings (nose / left / right / aft).
 * WarShips have SIX hex sides — nose, fore-left, fore-right, aft-left,
 * aft-right, aft — so the four corner facings are filled too (leftSide /
 * rightSide mirror the fore sides for DThr + the 4-box fallback).
 */
export interface DropshipArmorRaw {
  nose: number;
  leftSide: number;
  rightSide: number;
  aft: number;
  /** WarShip-only corner facings (undefined on DropShips). */
  foreLeft?: number;
  foreRight?: number;
  aftLeft?: number;
  aftRight?: number;
}

/** One transport bay from `<transporters>` (e.g. 'Mech ×4, Cargo 1800t). */
export interface DropshipBay {
  /** Display label ("'Mech", "Fighter", "Cargo", …). */
  label: string;
  /** Bay size: unit count for unit bays, tonnage for cargo. */
  size: number;
  /** True when `size` is tonnage (cargo bays). */
  tons?: boolean;
}

/** A fully-parsed DropShip — physical facts only. */
export interface DropshipUnit {
  kind: "dropship";
  /** "DropShip" or the larger "WarShip" (same BLK shape: bays + firing arcs). */
  shipClass: "DropShip" | "WarShip";
  chassis: string;
  model: string;
  techBase: TechBase;
  /** Tonnage (200–100,000). */
  tonnage: number;
  /** Airframe: "Spheroid" | "Aerodyne". */
  motionType: string;
  /** Safe Thrust. */
  safeThrust: number;
  /** Max Thrust: explicit if present, else ceil(safe * 1.5). */
  maxThrust: number;
  /** Heat-sink count from `<heatsinks>`. */
  heatSinkCount: number;
  /** Heat-sink tech from `<sink_type>`: 1 = double, 0 = single. */
  heatSinkType: HeatSinkType;
  /** TW Structural Integrity from `<structural_integrity>`. */
  structuralIntegrity: number;
  armor: DropshipArmorRaw;
  /** Armor type (for the pip shape); undefined = Standard/default. */
  armorType?: string;
  mounts: DropshipMount[];
  bays: DropshipBay[];
  sourceFile?: string;
}

/** Converted Override record-card statistics for a DropShip. */
export interface DropshipCard {
  kind: "dropship";
  /** "DropShip" or "WarShip" — drives the card's type label. */
  shipClass: "DropShip" | "WarShip";
  name: string;
  chassis: string;
  model: string;
  techBase: TechBase;
  tonnage: number;
  /** "Spheroid" | "Aerodyne". */
  motionLabel: string;
  /** Printed thrust string, e.g. "3 / 5" (safe / max). */
  move: string;
  safeThrust: number;
  maxThrust: number;
  /** Printed TMM: a SINGLE number, the higher (sprint) value on max thrust. */
  tmm: number;
  /** Override heat sinks: dissipation / 5, round nearest. */
  sinks: number;
  /** Damage Threshold: (nose + aft + one side) TW armor / 30, round nearest. */
  dthr: number;
  /** Per-arc Override armor (TW / 4, round nearest, min 1). */
  armor: DropshipArmorRaw;
  /** Armor type (for the pip shape); undefined = Standard/default. */
  armorType?: string;
  /** Single Structural Integrity: TW SI / 3, round nearest, min 1 (best-effort). */
  structure: number;
  /** Weapon rows (TICs grouped per arc; `facing` holds the arc code). */
  weapons: VehicleWeaponRow[];
  /** Raw per-arc weapons (rawLocation = facing) — source for the manual TIC editor. */
  weaponMounts: CardWeapon[];
  /** Auto-grouped TICs; the weapons rows above are derived from these. */
  tics: Tic[];
  equipment: VehicleEquipment[];
  /** Transport capacity ('Mech ×4, Fighter ×2, Cargo 1800t, …). */
  bays: DropshipBay[];
  warnings: string[];
  sourceFile?: string;
}
