/**
 * BLK parser: MegaMek .blk "building block" text -> typed unit.
 *
 * PURE module: no Node/browser/filesystem imports. Mirrors the contract of
 * parser.ts (text + optional filename -> physical facts), reusing the same
 * loud-failure policy via `ParseError`.
 *
 * BLK is a tag-delimited format:
 *
 *   <UnitType>
 *   BattleArmor
 *   </UnitType>
 *
 *   <Squad Equipment>
 *   CLERSmallLaser:LA
 *   </Squad Equipment>
 *
 * Scope: BattleArmor and Tank (combat vehicles). Other unit types (Aero,
 * Infantry, …) parse far enough to identify the type, then the dispatcher
 * throws a clear "unsupported" error. The block reader is generic, so extending
 * to further types is additive.
 */

import { BA_WEIGHT_CLASSES, RUN_MP_MULTIPLIER, TECH_BASE_MAP } from "./constants.js";
import { ParseError } from "./parser.js";
import type {
  BAWeightClass,
  BattleArmorUnit,
  BlkMount,
  DropshipArmorRaw,
  DropshipBay,
  DropshipFacing,
  DropshipMount,
  DropshipUnit,
  FighterArmorRaw,
  FighterFacing,
  FighterMount,
  FighterUnit,
  HeatSinkType,
  InfantryUnit,
  ProtoArmorRaw,
  ProtoLoc,
  ProtoMechUnit,
  ProtoMount,
  TechBase,
  VehicleArmorRaw,
  VehicleFacing,
  VehicleMount,
  VehicleUnit,
} from "./types.js";

/** One `<Tag> … </Tag>` block: its tag and the content lines between the tags. */
interface Block {
  /** Tag text exactly as written (e.g. "Squad Equipment"). */
  tag: string;
  /** Lowercased tag, for lookups. */
  key: string;
  /** Non-empty content lines, trimmed. */
  lines: string[];
}

/** True if the text looks like a BLK file (has a `<UnitType>`/`<BlockVersion>` tag). */
export function isBlk(text: string): boolean {
  return /<\s*(unittype|blockversion)\s*>/i.test(text);
}

/** The raw `<UnitType>` value (e.g. "BattleArmor", "Tank"), or undefined. */
export function blkUnitType(text: string): string | undefined {
  const m = text.match(/<\s*unittype\s*>\s*\n\s*([^\n<]+)/i);
  return m ? m[1]!.trim() : undefined;
}

/**
 * Parse the flat list of `<Tag>…</Tag>` blocks. Comment lines (`#…`) and blank
 * lines outside blocks are ignored; blank lines inside a block are dropped.
 * Repeated tags are preserved in order (equipment blocks rely on this).
 */
function readBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  let current: Block | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const open = line.match(/^<\s*([^/<>][^<>]*?)\s*>$/);
    const close = line.match(/^<\s*\/\s*([^<>]*?)\s*>$/);

    if (close && current) {
      blocks.push(current);
      current = null;
      continue;
    }
    if (open) {
      // A new opening tag implicitly closes a malformed/unterminated block.
      if (current) blocks.push(current);
      current = { tag: open[1]!, key: open[1]!.toLowerCase(), lines: [] };
      continue;
    }
    if (!current) continue; // text outside any block (comments/banners)
    if (line === "" || line.startsWith("#")) continue;
    current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks;
}

/** First content line of the first block with this (lowercased) tag, or undefined. */
function scalar(blocks: Block[], key: string): string | undefined {
  const b = blocks.find((x) => x.key === key);
  return b?.lines[0];
}

/** First scalar found among several candidate tags. */
function scalarAny(blocks: Block[], keys: string[]): string | undefined {
  for (const k of keys) {
    const v = scalar(blocks, k);
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * MegaMek BLK `<armor_type>` numeric code → armor name (only the ones we draw a
 * pip shape for; any other code maps to undefined = treated as Standard). Codes
 * validated against named variants in the corpus (2 Reactive, 3 Reflective,
 * 4 Hardened, 6 Heavy Ferro, 8/22 Stealth).
 */
const BLK_ARMOR_TYPE: Readonly<Record<string, string>> = {
  "1": "Ferro-Fibrous",
  "2": "Reactive",
  "3": "Reflective",
  "4": "Hardened",
  "5": "Light Ferro-Fibrous",
  "6": "Heavy Ferro-Fibrous",
  "8": "Stealth",
  "22": "Stealth",
};
function blkArmorType(blocks: Block[]): string | undefined {
  const code = scalar(blocks, "armor_type")?.trim();
  return code ? BLK_ARMOR_TYPE[code] : undefined;
}

function intOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const m = value.match(/-?\d+/);
  return m ? Number.parseInt(m[0], 10) : fallback;
}

/** Resolve tech base from `<TechBase>` or the rules-level `<type>` line. */
function resolveTechBase(blocks: Block[]): TechBase {
  const raw = scalarAny(blocks, ["techbase", "type"]);
  if (raw) {
    const lower = raw.toLowerCase();
    for (const [needle, value] of Object.entries(TECH_BASE_MAP)) {
      if (lower.startsWith(needle) || lower.includes(`(${needle}`)) return value;
    }
    if (lower.includes("clan")) return "Clan";
    if (lower.includes("inner sphere") || lower.includes("mixed")) return "IS";
  }
  return "IS"; // default; BA tech base rarely affects the reused weapon tables
}

/** Map the `<weightclass>` index (0..4) to a label; fall back to "Medium". */
function resolveWeightClass(blocks: Block[]): BAWeightClass {
  const idx = intOr(scalarAny(blocks, ["weightclass", "weight_class"]), -1);
  return BA_WEIGHT_CLASSES[idx] ?? "Medium";
}

/**
 * Collect weapon/equipment mounts. Each line is `Name` or `Name:LOC`. If the
 * file lists per-trooper blocks ("Trooper N Equipment"), each line is one mount
 * (copies = 1). Otherwise squad-wide blocks ("Squad Equipment", "Body", any
 * "* Equipment") are carried by every trooper (copies = troopers).
 */
function parseMounts(blocks: Block[], troopers: number): BlkMount[] {
  const trooperBlocks = blocks.filter((b) => /trooper\s*\d+\s*equipment/i.test(b.tag));
  const useTrooper = trooperBlocks.length > 0;
  const source = useTrooper
    ? trooperBlocks
    : blocks.filter((b) => b.key.includes("equipment"));
  const copies = useTrooper ? 1 : troopers;

  const mounts: BlkMount[] = [];
  for (const block of source) {
    for (const line of block.lines) {
      const colon = line.lastIndexOf(":");
      const name = (colon >= 0 ? line.slice(0, colon) : line).trim();
      const mount = colon >= 0 ? line.slice(colon + 1).trim() : "";
      if (name === "") continue;
      mounts.push({ name, mount, copies });
    }
  }
  return mounts;
}

/**
 * Parse BLK text into a `BattleArmorUnit`.
 *
 * @param text  Full contents of the .blk file.
 * @param file  Filename for error messages (defaults to "<unknown>").
 */
export function parseBlkBattleArmor(text: string, file = "<unknown>"): BattleArmorUnit {
  const blocks = readBlocks(text);

  const unitType = scalar(blocks, "unittype");
  if (unitType && unitType.toLowerCase().replace(/\s+/g, "") !== "battlearmor") {
    throw new ParseError(
      `unsupported BLK unit type "${unitType}" (only BattleArmor is supported so far)`,
      file,
      "UnitType",
    );
  }

  const chassis = scalarAny(blocks, ["name", "chassis_name"]);
  if (!chassis) throw new ParseError("missing unit name", file, "Name");
  const model = scalarAny(blocks, ["model"]) ?? "";

  const troopers = intOr(scalarAny(blocks, ["trooper count", "troopers", "squad_size"]), 0);
  if (troopers <= 0) {
    throw new ParseError("missing or invalid trooper count", file, "Trooper Count");
  }

  const walkMP = intOr(scalarAny(blocks, ["cruisemp", "walkmp"]), 1);
  const jumpMP = intOr(scalarAny(blocks, ["jumpingmp", "jumpmp", "vtolmp", "umump"]), 0);
  const motionType = scalarAny(blocks, ["motion_type"]) ?? "Leg";
  const armorPerTrooper = intOr(scalarAny(blocks, ["armor"]), 0);
  const chassisType = (scalarAny(blocks, ["chassis"]) ?? "biped").toLowerCase();

  return {
    kind: "battlearmor",
    chassis,
    model,
    techBase: resolveTechBase(blocks),
    troopers,
    weightClass: resolveWeightClass(blocks),
    walkMP,
    jumpMP,
    motionType,
    armorPerTrooper,
    chassisType,
    mounts: parseMounts(blocks, troopers),
  };
}

// ---------------------------------------------------------------------------
// Combat Vehicles (BLK Tank).
// ---------------------------------------------------------------------------

/** Equipment-block tag (lowercased) -> armor/equipment facing. */
const FACING_BLOCKS: Readonly<Record<string, VehicleFacing>> = {
  "body equipment": "body",
  "front equipment": "front",
  "right equipment": "right",
  "left equipment": "left",
  "rear equipment": "rear",
  "rotor equipment": "rotor",
  "turret equipment": "turret",
  "turret 2 equipment": "turret",
};

/**
 * Parse the `<armor>` block into facings.
 *
 * Ground vehicles list `front, right, left, rear, [turret]`. VTOLs always carry
 * a rotor, so their order is `front, right, left, rear, rotor, [turret]` — the
 * 5th value is the rotor, and a 6th value (if present) is the turret.
 */
function parseVehicleArmor(
  blocks: Block[],
  isVtol: boolean,
): { armor: VehicleArmorRaw; hasTurret: boolean } {
  const block = blocks.find((b) => b.key === "armor");
  const values = (block?.lines ?? [])
    .map((l) => Number.parseInt(l, 10))
    .filter((n) => Number.isFinite(n));
  const at = (i: number) => values[i] ?? 0;
  const base = { front: at(0), right: at(1), left: at(2), rear: at(3) };

  if (isVtol) {
    const hasTurret = values.length >= 6;
    return {
      armor: { ...base, rotor: at(4), ...(hasTurret ? { turret: at(5) } : {}) },
      hasTurret,
    };
  }
  const hasTurret = values.length >= 5;
  return {
    armor: { ...base, ...(hasTurret ? { turret: at(4) } : {}) },
    hasTurret,
  };
}

/** Collect weapon/equipment mounts from the per-facing equipment blocks. */
function parseVehicleMounts(blocks: Block[]): VehicleMount[] {
  const mounts: VehicleMount[] = [];
  for (const block of blocks) {
    const facing = FACING_BLOCKS[block.key];
    if (!facing) continue;
    for (const line of block.lines) {
      const name = line.trim();
      if (name) mounts.push({ name, facing });
    }
  }
  return mounts;
}

/**
 * Parse BLK Tank/VTOL text into a `VehicleUnit`. Throws if the file is neither a
 * Tank nor a VTOL (both share the combat-vehicle card; VTOLs add a rotor).
 *
 * @param text  Full contents of the .blk file.
 * @param file  Filename for error messages (defaults to "<unknown>").
 */
export function parseBlkVehicle(text: string, file = "<unknown>"): VehicleUnit {
  const blocks = readBlocks(text);

  const unitType = scalar(blocks, "unittype");
  const normalizedType = unitType?.toLowerCase().replace(/\s+/g, "");
  // Combat vehicles (Tank/VTOL), Support vehicles, and Naval (surface/hydrofoil)
  // craft all share the BLK structure (4 facings + turret, cruiseMP, equipment).
  const VEHICLE_TYPES = new Set(["tank", "vtol", "supporttank", "largesupporttank", "supportvtol", "naval"]);
  if (unitType && !VEHICLE_TYPES.has(normalizedType ?? "")) {
    throw new ParseError(
      `expected a Tank/VTOL or Support vehicle BLK but got unit type "${unitType}"`,
      file,
      "UnitType",
    );
  }
  const support = (normalizedType ?? "").startsWith("support") || normalizedType === "largesupporttank";

  const chassis = scalarAny(blocks, ["name", "chassis_name"]);
  if (!chassis) throw new ParseError("missing unit name", file, "Name");
  const model = scalarAny(blocks, ["model"]) ?? "";

  const tonnage = Number.parseFloat(scalarAny(blocks, ["tonnage", "weight"]) ?? "0") || 0;
  const motionType = scalarAny(blocks, ["motion_type"]) ?? "Tracked";
  const isVtol = normalizedType === "vtol" || normalizedType === "supportvtol" || motionType.toLowerCase() === "vtol";
  const cruiseMP = intOr(scalarAny(blocks, ["cruisemp", "walkmp"]), 0);
  const flankRaw = scalarAny(blocks, ["flankmp", "runmp"]);
  const flankMP = flankRaw !== undefined ? intOr(flankRaw, 0) : Math.ceil(cruiseMP * RUN_MP_MULTIPLIER);

  const { armor, hasTurret } = parseVehicleArmor(blocks, isVtol);

  return {
    kind: "vehicle",
    chassis,
    model,
    techBase: resolveTechBase(blocks),
    tonnage,
    motionType,
    cruiseMP,
    flankMP,
    armor,
    hasTurret,
    hasRotor: isVtol,
    armorType: blkArmorType(blocks),
    ...(support ? { support: true } : {}),
    mounts: parseVehicleMounts(blocks),
  };
}

// ---------------------------------------------------------------------------
// Aerospace & Conventional Fighters (BLK Aero / ConvFighter / FixedWingSupport).
// ---------------------------------------------------------------------------

/** BLK `<UnitType>` values (whitespace-stripped, lowercased) handled as fighters. */
const FIGHTER_UNIT_TYPES = new Set([
  "aero",
  "aerospacefighter",
  "convfighter",
  "fixedwingsupport",
]);

/** Conventional (atmospheric) fighter unit types — everything else is aerospace. */
const CONVENTIONAL_TYPES = new Set(["convfighter", "fixedwingsupport"]);

/** Equipment-block tag (lowercased) -> fighter facing. */
const FIGHTER_FACING_BLOCKS: Readonly<Record<string, FighterFacing>> = {
  "nose equipment": "nose",
  "left wing equipment": "leftWing",
  "right wing equipment": "rightWing",
  "aft equipment": "aft",
  "wings equipment": "wings",
  "fuselage equipment": "fuselage",
  "body equipment": "fuselage",
};

/** Parse the `<armor>` block (nose, right wing, left wing, aft) into facings. */
function parseFighterArmor(blocks: Block[]): FighterArmorRaw {
  const block = blocks.find((b) => b.key === "armor");
  const values = (block?.lines ?? [])
    .map((l) => Number.parseInt(l, 10))
    .filter((n) => Number.isFinite(n));
  const at = (i: number) => values[i] ?? 0;
  return { nose: at(0), rightWing: at(1), leftWing: at(2), aft: at(3) };
}

/**
 * Collect weapon/equipment mounts from the per-facing equipment blocks. Leading
 * single-letter parenthetical markers are stripped (as for DropShips): "(R)"
 * flags a rear-firing mount (e.g. a wing weapon aimed aft) and "(B)" opens a TW
 * bay — neither belongs in the weapon name, so "(R) ISMediumLaser" parses to the
 * known "Medium Laser" with `rear: true`.
 */
function parseFighterMounts(blocks: Block[]): FighterMount[] {
  const mounts: FighterMount[] = [];
  for (const block of blocks) {
    const facing = FIGHTER_FACING_BLOCKS[block.key];
    if (!facing) continue;
    for (const line of block.lines) {
      const raw = line.trim();
      if (!raw) continue;
      const markers = raw.match(/^(?:\([A-Za-z]\)\s*)+/)?.[0] ?? "";
      const name = raw.slice(markers.length).trim();
      if (name) mounts.push(/\(R\)/i.test(markers) ? { name, facing, rear: true } : { name, facing });
    }
  }
  return mounts;
}

/**
 * Parse BLK Aero/Conventional-fighter text into a `FighterUnit`. Throws if the
 * file is not a fighter type.
 *
 * @param text  Full contents of the .blk file.
 * @param file  Filename for error messages (defaults to "<unknown>").
 */
export function parseBlkFighter(text: string, file = "<unknown>"): FighterUnit {
  const blocks = readBlocks(text);

  const unitType = scalar(blocks, "unittype");
  const normalizedType = unitType?.toLowerCase().replace(/\s+/g, "");
  if (unitType && !FIGHTER_UNIT_TYPES.has(normalizedType ?? "")) {
    throw new ParseError(
      `expected an Aerospace/Conventional fighter BLK but got unit type "${unitType}"`,
      file,
      "UnitType",
    );
  }

  const chassis = scalarAny(blocks, ["name", "chassis_name"]);
  if (!chassis) throw new ParseError("missing unit name", file, "Name");
  const model = scalarAny(blocks, ["model"]) ?? "";

  const tonnage = Number.parseFloat(scalarAny(blocks, ["tonnage", "weight"]) ?? "0") || 0;
  const motionType = scalarAny(blocks, ["motion_type"]) ?? "Aerodyne";
  const conventional = CONVENTIONAL_TYPES.has(normalizedType ?? "");
  const safeThrust = intOr(scalarAny(blocks, ["safethrust", "cruisemp", "walkmp"]), 0);
  const maxRaw = scalarAny(blocks, ["maxthrust", "flankmp", "runmp"]);
  const maxThrust = maxRaw !== undefined ? intOr(maxRaw, 0) : Math.ceil(safeThrust * RUN_MP_MULTIPLIER);
  const heatSinkCount = intOr(scalar(blocks, "heatsinks"), 0);
  const heatSinkType: HeatSinkType = intOr(scalar(blocks, "sink_type"), 0) === 1 ? "double" : "single";
  const fuel = intOr(scalar(blocks, "fuel"), 0);

  return {
    kind: "fighter",
    chassis,
    model,
    techBase: resolveTechBase(blocks),
    tonnage,
    conventional,
    motionType,
    safeThrust,
    maxThrust,
    heatSinkCount,
    heatSinkType,
    fuel,
    armor: parseFighterArmor(blocks),
    armorType: blkArmorType(blocks),
    mounts: parseFighterMounts(blocks),
  };
}

// ---------------------------------------------------------------------------
// Conventional Infantry (BLK Infantry).
// ---------------------------------------------------------------------------

/** Collect the towed field-gun weapon names from the `<Field Guns Equipment>` block. */
function parseFieldGuns(blocks: Block[]): string[] {
  const block = blocks.find((b) => b.key === "field guns equipment");
  const guns: string[] = [];
  for (const line of block?.lines ?? []) {
    // Skip ammo; field guns are the weapons themselves.
    if (/\bammo\b/i.test(line)) continue;
    const colon = line.lastIndexOf(":");
    const name = (colon >= 0 ? line.slice(0, colon) : line).trim();
    if (name) guns.push(name);
  }
  return guns;
}

/**
 * Parse BLK Infantry text into an `InfantryUnit`. Throws if the file is not
 * Infantry.
 *
 * @param text  Full contents of the .blk file.
 * @param file  Filename for error messages (defaults to "<unknown>").
 */
export function parseBlkInfantry(text: string, file = "<unknown>"): InfantryUnit {
  const blocks = readBlocks(text);

  const unitType = scalar(blocks, "unittype");
  if (unitType && unitType.toLowerCase() !== "infantry") {
    throw new ParseError(`expected an Infantry BLK but got unit type "${unitType}"`, file, "UnitType");
  }

  const chassis = scalarAny(blocks, ["name", "chassis_name"]);
  if (!chassis) throw new ParseError("missing unit name", file, "Name");
  const model = scalarAny(blocks, ["model"]) ?? "";

  const squadSize = intOr(scalarAny(blocks, ["squad_size", "squadsize"]), 1);
  const squadCount = intOr(scalarAny(blocks, ["squadn", "squad_count"]), 1);
  const motionType = scalarAny(blocks, ["motion_type"]) ?? "Leg";
  const primaryWeapon = scalarAny(blocks, ["primary"]) ?? "";
  const secondaryWeapon = scalarAny(blocks, ["secondary"]);
  const secondaryPerSquad = intOr(scalarAny(blocks, ["secondn"]), 0);
  // The <antimek> tag (an anti-'Mech skill value) is present only when the
  // platoon can make anti-'Mech attacks.
  const antiMek = scalarAny(blocks, ["antimek"]) !== undefined;

  return {
    kind: "infantry",
    chassis,
    model,
    techBase: resolveTechBase(blocks),
    troopers: squadSize * squadCount,
    squadSize,
    squadCount,
    motionType,
    primaryWeapon,
    ...(secondaryWeapon ? { secondaryWeapon } : {}),
    secondaryPerSquad,
    antiMek,
    fieldGuns: parseFieldGuns(blocks),
  };
}

// ---------------------------------------------------------------------------
// ProtoMech (BLK ProtoMech).
// ---------------------------------------------------------------------------

/** Per-location equipment blocks -> ProtoMech location. */
const PROTO_LOC_BLOCKS: Readonly<Record<string, ProtoLoc>> = {
  "head equipment": "head",
  "torso equipment": "torso",
  "right arm equipment": "rightArm",
  "left arm equipment": "leftArm",
  "legs equipment": "legs",
  "leg equipment": "legs",
  "main gun equipment": "mainGun",
};

/** Armor block order: Head, Torso, R-Arm, L-Arm, Legs, [Main Gun]. */
function parseProtoArmor(blocks: Block[]): ProtoArmorRaw {
  const block = blocks.find((b) => b.key === "armor");
  const v = (block?.lines ?? []).map((l) => Number.parseInt(l, 10)).filter((n) => Number.isFinite(n));
  const at = (i: number) => v[i] ?? 0;
  return { head: at(0), torso: at(1), rightArm: at(2), leftArm: at(3), legs: at(4), mainGun: at(5) };
}

/** Count of numeric armor values (6 = a Main Gun is present). */
function protoArmorCount(blocks: Block[]): number {
  const block = blocks.find((b) => b.key === "armor");
  return (block?.lines ?? []).map((l) => Number.parseInt(l, 10)).filter((n) => Number.isFinite(n)).length;
}

/** Collect weapon/equipment mounts from the per-location equipment blocks. */
function parseProtoMounts(blocks: Block[]): ProtoMount[] {
  const mounts: ProtoMount[] = [];
  for (const block of blocks) {
    const loc = PROTO_LOC_BLOCKS[block.key] ?? (block.key === "body equipment" ? "torso" : undefined);
    if (!loc) continue;
    for (const line of block.lines) {
      const name = line.trim();
      if (name) mounts.push({ name, loc });
    }
  }
  return mounts;
}

/**
 * Parse BLK ProtoMech text into a `ProtoMechUnit`. Throws if the file is not a
 * ProtoMech.
 */
export function parseBlkProto(text: string, file = "<unknown>"): ProtoMechUnit {
  const blocks = readBlocks(text);

  const unitType = scalar(blocks, "unittype");
  if (unitType && unitType.toLowerCase().replace(/\s+/g, "") !== "protomech") {
    throw new ParseError(`expected a ProtoMech BLK but got unit type "${unitType}"`, file, "UnitType");
  }

  const chassis = scalarAny(blocks, ["name", "chassis_name"]);
  if (!chassis) throw new ParseError("missing unit name", file, "Name");
  const model = scalarAny(blocks, ["model"]) ?? "";

  const tonnage = Number.parseFloat(scalarAny(blocks, ["tonnage", "weight"]) ?? "0") || 0;
  const motionType = scalarAny(blocks, ["motion_type"]) ?? "Biped";
  const walkMP = intOr(scalarAny(blocks, ["cruisemp", "walkmp"]), 0);
  const jumpMP = intOr(scalarAny(blocks, ["jumpingmp", "jumpmp"]), 0);

  const armor = parseProtoArmor(blocks);
  const mounts = parseProtoMounts(blocks);
  const hasMainGun = protoArmorCount(blocks) >= 6;
  const hasArms =
    armor.rightArm > 0 || armor.leftArm > 0 || mounts.some((m) => m.loc === "rightArm" || m.loc === "leftArm");

  return {
    kind: "protomech",
    chassis,
    model,
    techBase: resolveTechBase(blocks),
    tonnage,
    motionType,
    walkMP,
    jumpMP,
    hasArms,
    hasMainGun,
    armor,
    armorType: blkArmorType(blocks),
    mounts,
  };
}

// ---------------------------------------------------------------------------
// DropShip (BLK Dropship).
// ---------------------------------------------------------------------------

/** Per-arc equipment blocks -> DropShip facing. */
const DROPSHIP_FACING_BLOCKS: Readonly<Record<string, DropshipFacing>> = {
  "nose equipment": "nose",
  "left side equipment": "leftSide",
  "right side equipment": "rightSide",
  "aft equipment": "aft",
  "hull equipment": "hull",
  // WarShip firing arcs (more than a DropShip's four).
  "left front side equipment": "foreLeft",
  "right front side equipment": "foreRight",
  "aft left side equipment": "aftLeft",
  "aft right side equipment": "aftRight",
  "left broadsides equipment": "leftBroad",
  "right broadsides equipment": "rightBroad",
};

/** `<transporters>` bay type -> display label (unit bays count units; cargo is tons). */
const DROPSHIP_BAY_LABELS: Readonly<Record<string, { label: string; tons?: boolean }>> = {
  mechbay: { label: "'Mech" },
  asfbay: { label: "Fighter" },
  artsasfbay: { label: "Fighter" },
  smallcraftbay: { label: "Small Craft" },
  battlearmorbay: { label: "Battle Armor" },
  infantrybay: { label: "Infantry", tons: true },
  lightvehiclebay: { label: "Light Vehicle" },
  heavyvehiclebay: { label: "Heavy Vehicle" },
  protomechbay: { label: "ProtoMech" },
  cargobay: { label: "Cargo", tons: true },
  liquidcargobay: { label: "Liquid Cargo", tons: true },
};

/**
 * Armor block facings. DropShip order (4 values): nose, left side, right side,
 * aft. WarShip order (6 values): nose, fore-left, fore-right, AFT, aft-left,
 * aft-right — the aft (the thin rear facing) is index 3, NOT index 5. We surface
 * all six on the WarShip diagram; leftSide / rightSide mirror the fore sides so
 * the DThr math and the 4-box code keep working.
 */
function parseDropshipArmor(blocks: Block[]): DropshipArmorRaw {
  const block = blocks.find((b) => b.key === "armor");
  const v = (block?.lines ?? []).map((l) => Number.parseInt(l, 10)).filter((n) => Number.isFinite(n));
  const at = (i: number) => v[i] ?? 0;
  if (v.length >= 6) {
    return {
      nose: at(0),
      leftSide: at(1), // = fore-left
      rightSide: at(2), // = fore-right
      aft: at(3),
      foreLeft: at(1),
      foreRight: at(2),
      aftLeft: at(4),
      aftRight: at(5),
    };
  }
  return { nose: at(0), leftSide: at(1), rightSide: at(2), aft: at(3) };
}

/**
 * Collect weapon/equipment mounts from the per-arc equipment blocks. Leading
 * single-letter parenthetical markers are read then stripped: "(B)" opens a TW
 * bay (an aero fire-grouping the Override card replaces with TICs) and "(R)"
 * marks the rear sub-arc — on a spheroid that's the aft half of a side arc. So
 * "(R) (B) ISERLargeLaser" becomes the known "ER Large Laser" with `rear: true`.
 */
function parseDropshipMounts(blocks: Block[]): DropshipMount[] {
  const facingBlocks = blocks.filter((b) => DROPSHIP_FACING_BLOCKS[b.key]);
  // MegaMek marks each weapon bay with a leading "(B)" on its first weapon; the
  // unprefixed lines beneath it belong to that same bay (and "Ammo …" lines are
  // the bay's ammo). Only bay-aware files get bay ids — a markerless BLK leaves
  // `bay` undefined and the converter falls back to auto-grouping.
  const hasBays = facingBlocks.some((b) => b.lines.some((l) => /\(B\)/.test(l)));
  const mounts: DropshipMount[] = [];
  let bayId = 0;
  for (const block of facingBlocks) {
    const facing = DROPSHIP_FACING_BLOCKS[block.key]!;
    let currentBay = -1; // a bay never spans an arc, so reset each block
    for (const line of block.lines) {
      const markers = line.match(/^(?:\([A-Za-z]\)\s*)+/)?.[0] ?? "";
      const startsBay = /\(B\)/.test(markers);
      const rear = /\(R\)/i.test(markers);
      const name = line.slice(markers.length).trim();
      if (!name) continue;
      const base: DropshipMount = rear ? { name, facing, rear: true } : { name, facing };
      if (!hasBays) {
        mounts.push(base);
        continue;
      }
      if (startsBay || currentBay === -1) currentBay = ++bayId;
      mounts.push({ ...base, bay: currentBay });
    }
  }
  return mounts;
}

/** Transport bays from `<transporters>` lines (`type:size:doors[:bay]`); quarters etc. skipped. */
function parseDropshipBays(blocks: Block[]): DropshipBay[] {
  const block = blocks.find((b) => b.key === "transporters");
  const bays: DropshipBay[] = [];
  for (const line of block?.lines ?? []) {
    const [type, sizeRaw] = line.split(":");
    const spec = DROPSHIP_BAY_LABELS[(type ?? "").toLowerCase().trim()];
    if (!spec) continue;
    const size = Number.parseFloat(sizeRaw ?? "0") || 0;
    if (size <= 0) continue;
    const existing = bays.find((b) => b.label === spec.label);
    if (existing) existing.size += size;
    else bays.push({ label: spec.label, size, ...(spec.tons ? { tons: true } : {}) });
  }
  return bays;
}

/** Parse BLK DropShip text into a `DropshipUnit`. Throws if not a Dropship. */
export function parseBlkDropship(text: string, file = "<unknown>"): DropshipUnit {
  const blocks = readBlocks(text);

  const unitType = (scalar(blocks, "unittype") ?? "").toLowerCase().replace(/\s+/g, "");
  if (unitType && unitType !== "dropship" && unitType !== "warship") {
    throw new ParseError(`expected a DropShip or WarShip BLK but got unit type "${unitType}"`, file, "UnitType");
  }
  const shipClass = unitType === "warship" ? "WarShip" : "DropShip";

  const chassis = scalarAny(blocks, ["name", "chassis_name"]);
  if (!chassis) throw new ParseError("missing unit name", file, "Name");
  const model = scalarAny(blocks, ["model"]) ?? "";

  const tonnage = Number.parseFloat(scalarAny(blocks, ["tonnage", "weight"]) ?? "0") || 0;
  const motionType = scalarAny(blocks, ["motion_type"]) ?? "Spheroid";
  const safeThrust = intOr(scalarAny(blocks, ["safethrust", "cruisemp"]), 0);
  const maxRaw = scalarAny(blocks, ["maxthrust", "flankmp"]);
  const maxThrust = maxRaw !== undefined ? intOr(maxRaw, 0) : Math.ceil(safeThrust * RUN_MP_MULTIPLIER);
  const heatSinkCount = intOr(scalar(blocks, "heatsinks"), 0);
  const heatSinkType: HeatSinkType = intOr(scalar(blocks, "sink_type"), 0) === 1 ? "double" : "single";
  const structuralIntegrity = intOr(scalar(blocks, "structural_integrity"), 0);

  return {
    kind: "dropship",
    shipClass,
    chassis,
    model,
    techBase: resolveTechBase(blocks),
    tonnage,
    motionType,
    safeThrust,
    maxThrust,
    heatSinkCount,
    heatSinkType,
    structuralIntegrity,
    armor: parseDropshipArmor(blocks),
    armorType: blkArmorType(blocks),
    mounts: parseDropshipMounts(blocks),
    bays: parseDropshipBays(blocks),
  };
}
