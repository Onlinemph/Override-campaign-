/**
 * Format dispatch: text -> the right parser + converter, returning a tagged
 * card. Keeps the 'Mech, Battle Armor, and Combat Vehicle paths separate while
 * giving callers (CLI, web) a single entry point.
 *
 * PURE module: no Node/browser/filesystem imports.
 */

import { convertBattleArmor } from "./battlearmor.js";
import { blkUnitType, isBlk, parseBlkBattleArmor, parseBlkDropship, parseBlkFighter, parseBlkInfantry, parseBlkProto, parseBlkVehicle } from "./blk.js";
import { convertUnit } from "./convert.js";
import { convertDropship } from "./dropship.js";
import { convertFighter } from "./fighter.js";
import { convertInfantry } from "./infantry.js";
import { ParseError, parseMtf } from "./parser.js";
import { convertProto } from "./proto.js";
import { convertVehicle } from "./vehicle.js";
import type { BattleArmorCard, DropshipCard, FighterCard, InfantryCard, OverrideCard, ProtoMechCard, VehicleCard } from "./types.js";

/** A converted card, tagged by which unit family produced it. */
export type AnyCard =
  | { kind: "mech"; card: OverrideCard }
  | { kind: "battlearmor"; card: BattleArmorCard }
  | { kind: "vehicle"; card: VehicleCard }
  | { kind: "fighter"; card: FighterCard }
  | { kind: "infantry"; card: InfantryCard }
  | { kind: "protomech"; card: ProtoMechCard }
  | { kind: "dropship"; card: DropshipCard };

/** BLK `<UnitType>` values (whitespace-stripped) routed to the fighter path. */
const FIGHTER_TYPES = new Set(["aero", "aerospacefighter", "convfighter", "fixedwingsupport"]);

/** "blk" for MegaMek building-block files, otherwise "mtf". */
export function detectFormat(text: string): "mtf" | "blk" {
  return isBlk(text) ? "blk" : "mtf";
}

/**
 * Parse + convert any supported source, dispatching on the file content:
 *   - MTF                            -> BattleMech
 *   - BLK BattleArmor                -> Battle Armor
 *   - BLK Tank / VTOL                -> Combat Vehicle
 *   - BLK Aero / ConvFighter / …     -> Aerospace/Conventional Fighter
 *   - BLK Infantry                   -> Conventional Infantry
 * Other BLK unit types throw a clear "unsupported" ParseError.
 */
export function convertAny(text: string, file = "<unknown>"): AnyCard {
  if (detectFormat(text) === "mtf") {
    return { kind: "mech", card: convertUnit(parseMtf(text, file)) };
  }
  const type = (blkUnitType(text) ?? "").toLowerCase().replace(/\s+/g, "");
  if (type === "battlearmor") {
    return { kind: "battlearmor", card: convertBattleArmor(parseBlkBattleArmor(text, file)) };
  }
  if (type === "tank" || type === "vtol" || type === "supporttank" || type === "largesupporttank" || type === "supportvtol" || type === "naval") {
    return { kind: "vehicle", card: convertVehicle(parseBlkVehicle(text, file)) };
  }
  if (FIGHTER_TYPES.has(type)) {
    return { kind: "fighter", card: convertFighter(parseBlkFighter(text, file)) };
  }
  if (type === "infantry") {
    return { kind: "infantry", card: convertInfantry(parseBlkInfantry(text, file)) };
  }
  if (type === "protomech") {
    return { kind: "protomech", card: convertProto(parseBlkProto(text, file)) };
  }
  if (type === "dropship" || type === "warship") {
    return { kind: "dropship", card: convertDropship(parseBlkDropship(text, file)) };
  }
  throw new ParseError(
    `unsupported BLK unit type "${blkUnitType(text) ?? "?"}" (supported: BattleArmor, Tank, VTOL, Aerospace/Conventional Fighter, Infantry, ProtoMech, DropShip, WarShip)`,
    file,
    "UnitType",
  );
}
