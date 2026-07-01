/**
 * MTF parser: MegaMek .mtf text -> typed `Unit`.
 *
 * PURE module: no Node/browser/filesystem imports. The caller (CLI) reads the
 * file and passes the text plus an optional filename used only for error
 * messages. The parser is deliberately decoupled from the conversion math
 * (convert.ts) — it produces physical facts only.
 *
 * Failure policy: fail loudly. Every error names the source file and the
 * missing/malformed field via `ParseError`.
 */

import {
  ARMOR_KEY_MAP,
  INTERNAL_STRUCTURE_BY_TONNAGE,
  RUN_MP_MULTIPLIER,
  TECH_BASE_MAP,
  WEAPON_LOCATION_MAP,
  structureRowToLocations,
} from "./constants.js";
import type {
  CritSlot,
  Engine,
  HeatSinkType,
  MechLocation,
  Movement,
  TechBase,
  Unit,
  Weapon,
} from "./types.js";

/** Error thrown for any malformed/missing MTF field. Always names the file. */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly file: string,
    public readonly field?: string,
  ) {
    const where = field ? ` [field: ${field}]` : "";
    super(`${file}: ${message}${where}`);
    this.name = "ParseError";
  }
}

interface RawLine {
  /** Raw text, trimmed of surrounding whitespace and trailing CR. */
  text: string;
  /** 1-based line number for diagnostics. */
  lineNo: number;
}

/**
 * Parse MTF text into a `Unit`.
 *
 * @param text  Full contents of the .mtf file.
 * @param file  Filename for error messages (defaults to "<unknown>").
 */
export function parseMtf(text: string, file = "<unknown>"): Unit {
  const lines = splitLines(text);

  const { chassis, model } = parseNames(lines, file);
  const mass = parseMass(lines, file);
  const techBase = parseTechBase(lines, file);
  const config = getValue(lines, "config") ?? "Biped";
  const engine = parseEngine(lines, file);
  const movement = parseMovement(lines, file);
  const heatSinks = parseHeatSinks(lines, file);
  const armorType = getValue(lines, "armor"); // bare "Armor:" line (type, not a location)
  const structureType = getValue(lines, "structure"); // e.g. "IS Reinforced", "Endo Steel"
  const cockpitType = getValue(lines, "cockpit"); // e.g. "Torso-Mounted Cockpit"
  const gyroType = getValue(lines, "gyro"); // e.g. "Compact Gyro", "XL Gyro"
  const armor = parseArmor(lines, file);
  const structure = deriveStructure(mass, file, /quad/i.test(config), /tripod/i.test(config));
  const weapons = parseWeapons(lines, file);
  const critSlots = parseCritSlots(lines);

  return {
    chassis,
    model,
    mass,
    techBase,
    config,
    engine,
    movement,
    heatSinks,
    armorType,
    structureType,
    cockpitType,
    gyroType,
    armor,
    structure,
    weapons,
    critSlots,
  };
}

// ---------------------------------------------------------------------------
// Line helpers
// ---------------------------------------------------------------------------

function splitLines(text: string): RawLine[] {
  return text.split("\n").map((raw, i) => ({
    text: raw.replace(/\r$/, "").trim(),
    lineNo: i + 1,
  }));
}

/**
 * Return the value of the first `key:value` line (case-insensitive key match),
 * or undefined. Splits on the FIRST colon so values may contain colons.
 */
function getValue(lines: RawLine[], key: string): string | undefined {
  const want = key.toLowerCase();
  for (const { text } of lines) {
    const idx = text.indexOf(":");
    if (idx < 0) continue;
    if (text.slice(0, idx).trim().toLowerCase() === want) {
      return text.slice(idx + 1).trim();
    }
  }
  return undefined;
}

function requireValue(lines: RawLine[], key: string, file: string): string {
  const v = getValue(lines, key);
  if (v === undefined || v === "") {
    throw new ParseError(`missing required field "${key}"`, file, key);
  }
  return v;
}

/** Parse an integer, throwing a ParseError naming the field on failure. */
function parseIntStrict(value: string, field: string, file: string): number {
  const m = value.match(/-?\d+/);
  if (!m) {
    throw new ParseError(`expected a number but got "${value}"`, file, field);
  }
  return Number.parseInt(m[0], 10);
}

// ---------------------------------------------------------------------------
// Field parsers
// ---------------------------------------------------------------------------

/**
 * Chassis/model. Supports two MTF conventions:
 *   - keyed:   `chassis:Locust` / `model:LCT-1V`
 *   - legacy:  a leading `Version:x.y` line, then chassis and model each on
 *              their own keyless line.
 *
 * The model may be blank: many Clan 'Mechs (e.g. Kodiak, Arctic Wolf) are named
 * by chassis alone and ship an empty `model:` line. A present chassis is enough.
 */
function parseNames(lines: RawLine[], file: string): { chassis: string; model: string } {
  const chassis = getValue(lines, "chassis");
  const model = getValue(lines, "model");
  if (chassis) {
    return { chassis, model: model ?? "" };
  }

  // Legacy format: Version: line followed by two keyless lines.
  const nonEmpty = lines.filter((l) => l.text !== "");
  if (nonEmpty[0] && /^version:/i.test(nonEmpty[0].text)) {
    const c = nonEmpty[1]?.text;
    const m = nonEmpty[2]?.text;
    if (c && !c.includes(":")) {
      return { chassis: c, model: m && !m.includes(":") ? m : "" };
    }
  }

  throw new ParseError(`missing chassis name`, file, "chassis");
}

function parseMass(lines: RawLine[], file: string): number {
  const mass = parseIntStrict(requireValue(lines, "mass", file), "mass", file);
  if (mass <= 0) throw new ParseError(`invalid mass ${mass}`, file, "mass");
  return mass;
}

function parseTechBase(lines: RawLine[], file: string): TechBase {
  // Common key is "TechBase"; some files use "Tech Base".
  const raw = getValue(lines, "techbase") ?? getValue(lines, "tech base");
  if (raw === undefined) {
    throw new ParseError(`missing tech base`, file, "TechBase");
  }
  const lower = raw.toLowerCase();
  // Mixed tech ("Mixed (Clan Chassis)" / "Mixed (IS Chassis)"): use the chassis
  // tech as the unit's nominal base. Per-weapon CL/IS prefixes still override
  // the damage/range lookup (see detectWeaponTech in convert.ts), so a mixed
  // 'Mech converts each weapon on its own tech rather than failing to parse.
  if (lower.startsWith("mixed")) return lower.includes("clan") ? "Clan" : "IS";
  // Otherwise match on a known prefix.
  for (const [needle, value] of Object.entries(TECH_BASE_MAP)) {
    if (lower.startsWith(needle)) return value;
  }
  throw new ParseError(`unrecognized tech base "${raw}"`, file, "TechBase");
}

/** Engine line, e.g. "160 Fusion Engine", "300 XL (Clan) Engine(IS)". */
function parseEngine(lines: RawLine[], file: string): Engine {
  const raw = requireValue(lines, "engine", file);
  const rating = parseIntStrict(raw, "engine", file);
  // The portion before "Engine" holds the type and a "(Clan)" tech marker.
  const head = raw.replace(/^\s*\d+\s*/, "").split(/\bengine\b/i)[0] ?? "";
  const clan = /clan/i.test(head);
  // Type = the head with the "(Clan)" / "(IS)" markers and any parenthetical removed.
  const type = head.replace(/\(.*?\)/g, "").trim();
  return { rating, type: type || "Fusion", clan };
}

/**
 * Movement: Walk MP (required), Jump MP (optional, default 0), and Run MP
 * (explicit if present, else ceil(walk * 1.5)).
 */
function parseMovement(lines: RawLine[], file: string): Movement {
  const walkMP = parseIntStrict(requireValue(lines, "walk mp", file), "Walk MP", file);

  const jumpRaw = getValue(lines, "jump mp");
  const jumpMP = jumpRaw === undefined ? 0 : parseIntStrict(jumpRaw, "Jump MP", file);

  const runRaw = getValue(lines, "run mp");
  let runMP: number;
  let runDerived: boolean;
  if (runRaw === undefined || runRaw === "") {
    runMP = Math.ceil(walkMP * RUN_MP_MULTIPLIER);
    runDerived = true;
  } else {
    runMP = parseIntStrict(runRaw, "Run MP", file);
    runDerived = false;
  }

  return { walkMP, runMP, jumpMP, runDerived };
}

/** Heat sinks line, e.g. "10 Single", "20 Double (Clan)". */
function parseHeatSinks(lines: RawLine[], file: string): { count: number; type: HeatSinkType } {
  const raw = requireValue(lines, "heat sinks", file);
  const count = parseIntStrict(raw, "Heat Sinks", file);
  const type: HeatSinkType = /double/i.test(raw) ? "double" : "single";
  return { count, type };
}

/**
 * Per-location armor. Armor lines look like `LT Armor:8` or `RTC armor:3`. The
 * key before "armor"/"armour" is normalized via ARMOR_KEY_MAP, covering the
 * rear-line spelling variants across MTF versions.
 */
function parseArmor(lines: RawLine[], file: string): Partial<Record<MechLocation, number>> {
  const armor: Partial<Record<MechLocation, number>> = {};

  for (const { text } of lines) {
    const m = text.match(/^([A-Za-z]{2,3})\s+armou?r\s*:\s*(-?\d+)/i);
    if (!m) continue;
    const key = m[1]!.toUpperCase();
    const loc = ARMOR_KEY_MAP[key];
    if (!loc) continue; // skip unknown armor keys rather than guessing
    armor[loc] = Number.parseInt(m[2]!, 10);
  }

  if (Object.keys(armor).length === 0) {
    throw new ParseError(`no armor lines found`, file, "Armor");
  }
  return armor;
}

/**
 * Per-location critical-slot blocks, e.g.:
 *
 *   Right Torso:
 *   Autocannon/20
 *   ...
 *   IS Ammo AC/20
 *   ISCASE
 *   -Empty-
 *
 * A header line is exactly a location name followed by ":". Each subsequent
 * non-empty line is one occupied slot until a blank line or the next header.
 * "-Empty-" slots are skipped. Absent entirely (many hand-written MTFs) -> [].
 */
function parseCritSlots(lines: RawLine[]): CritSlot[] {
  const slots: CritSlot[] = [];
  let location: MechLocation | null = null;
  let rawLocation = "";

  for (const { text } of lines) {
    if (text.endsWith(":")) {
      const header = text.slice(0, -1).trim();
      const loc = WEAPON_LOCATION_MAP[header.toLowerCase()];
      if (loc) {
        location = loc;
        rawLocation = header;
        continue;
      }
    }
    if (!location) continue;
    if (text === "") {
      location = null; // blank line ends the block
      continue;
    }
    if (text.toLowerCase() === "-empty-") continue;
    slots.push({ name: text, location, rawLocation });
  }

  return slots;
}

/**
 * Internal structure is NOT in MTF text — derive it from tonnage via the
 * standard table. Throws if the tonnage is not a standard 'Mech weight.
 */
function deriveStructure(mass: number, file: string, isQuad = false, isTripod = false) {
  const row = INTERNAL_STRUCTURE_BY_TONNAGE[mass];
  if (!row) {
    throw new ParseError(
      `no internal-structure table entry for ${mass} tons`,
      file,
      "mass/structure",
    );
  }
  return structureRowToLocations(row, isQuad, isTripod);
}

/**
 * Weapons block: a `Weapons:N` line followed by N entries. The canonical form
 * is "Name, Location", but real MegaMek exports often append extra
 * comma-separated fields (ammo count, facing, omni flags), e.g.
 * "SRM 6, Left Torso, 2" or "Medium Laser, Left Arm, , ". So the NAME is the
 * first field and the LOCATION is the SECOND; any further fields are ignored.
 * A "(R)" marker on the name or location marks a rear-mounted weapon.
 */
/**
 * Split a weapon line on commas that are NOT inside parentheses or brackets, so
 * weapon names with internal commas survive intact, e.g.
 * "Rifle (Cannon, Heavy), Left Torso" -> ["Rifle (Cannon, Heavy)", "Left Torso"].
 */
function splitWeaponFields(text: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      fields.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  fields.push(text.slice(start).trim());
  return fields;
}

function parseWeapons(lines: RawLine[], file: string): Weapon[] {
  const idx = lines.findIndex((l) => /^weapons\s*:/i.test(l.text));
  if (idx < 0) {
    throw new ParseError(`missing weapons block`, file, "Weapons");
  }

  const count = parseIntStrict(lines[idx]!.text.split(":")[1] ?? "", "Weapons", file);
  const weapons: Weapon[] = [];

  let cursor = idx + 1;
  while (weapons.length < count && cursor < lines.length) {
    const line = lines[cursor]!;
    cursor++;
    if (line.text === "") continue;

    const fields = splitWeaponFields(line.text);
    if (fields.length < 2 || fields[0] === "") {
      throw new ParseError(
        `malformed weapon line "${line.text}" (expected "Name, Location")`,
        file,
        "Weapons",
      );
    }

    let name = fields[0]!;
    let rawLocation = fields[1]!; // location is the SECOND field; ignore any after

    // Rear-mounted flag. MTF variants put the "(R)" marker on either side:
    // "Medium Laser (R), Center Torso" or "Medium Laser, Center Torso (R)".
    const rearRe = /\(\s*r\s*\)$/i;
    const rearMounted = rearRe.test(name) || rearRe.test(rawLocation);
    name = name.replace(rearRe, "").trim();
    rawLocation = rawLocation.replace(rearRe, "").trim();

    const loc = WEAPON_LOCATION_MAP[rawLocation.toLowerCase()];
    if (!loc) {
      throw new ParseError(
        `unknown weapon location "${rawLocation}" for "${name}"`,
        file,
        "Weapons",
      );
    }

    weapons.push({ name, location: loc, rawLocation, rearMounted });
  }

  if (weapons.length < count) {
    throw new ParseError(
      `weapons block claims ${count} entries but only ${weapons.length} found`,
      file,
      "Weapons",
    );
  }
  return weapons;
}
