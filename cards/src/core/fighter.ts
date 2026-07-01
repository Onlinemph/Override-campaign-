/**
 * Aerospace / Conventional Fighter conversion: `FighterUnit` -> `FighterCard`.
 *
 * PURE module. Reuses the 'Mech weapon engine: weapons are grouped into TICs
 * PER FACING (nose / wings / aft stay separate), then abbreviated and heat-rated
 * exactly like the 'Mech and vehicle cards.
 *
 * Armor = TW/4 (VERIFIED); SI is a single airframe-wide value by tonnage
 * bracket; move shows "safe / max" thrust; TMM is a SINGLE number (the higher
 * sprint value on max thrust); Sinks = dissipation/5 (aerospace only — conv.
 * fighters do not track heat); DThr = (nose + aft + one wing) OVERRIDE armor / 30
 * (the reduced TW/4 card armor, ~10% of a side). Sinks / TMM VERIFIED vs the DFA
 * Aeshna mockup. Hit locations use the Override
 * fighter table (Nose 6-8, R-Wing 3-5, L-Wing 9-11, Aft 2 & 12).
 */

import { IMPORTANT_EQUIPMENT, VEHICLE_ARMOR_DIVISOR, vehicleStructure } from "./constants.js";
import {
  ammoLabel,
  convertWeapon,
  groupIntoTics,
  isWarshipWeapon,
  isNonWeaponMount,
  isWeaponBlockEquipment,
  lookupTmm,
  lookupWeaponDamage,
  looksLikeWeapon,
  normalizeWeaponName,
  roundNearest,
  ticRow,
} from "./convert.js";
import type {
  CardWeapon,
  FighterArmorRaw,
  FighterCard,
  FighterCardArmor,
  FighterFacing,
  FighterMount,
  FighterUnit,
  TechBase,
  Tic,
  VehicleEquipment,
  VehicleWeaponRow,
  Weapon,
} from "./types.js";

/** Rebuild the per-facing weapon rows from TICs (shared by the converter and the
 * TIC editor), in canonical facing order. */
export function fighterWeaponRows(tics: ReadonlyArray<Tic>, techBase: TechBase): VehicleWeaponRow[] {
  const order = (t: Tic) => FACING_ORDER.indexOf(t.weapons[0]!.rawLocation as FighterFacing);
  return [...tics]
    .sort((a, b) => order(a) - order(b))
    .map((t) => {
      const w0 = t.weapons[0]!;
      // Rear-firing wing/nose mounts (parsed from a "(R)" marker) get an "(R)" on
      // their facing code so the card shows e.g. "LW (R)".
      const code = FACING_CODE[w0.rawLocation as FighterFacing] + (w0.rearMounted ? " (R)" : "");
      return ticRow(t, techBase, code);
    });
}

/** All fighter weapons share one synthetic location; grouping is scoped per facing. */
const FIGHTER_LOCATION = "CT" as const;

/** Facing -> short code shown on the card (Loc column / equipment). */
const FACING_CODE: Readonly<Record<FighterFacing, string>> = {
  nose: "NO",
  leftWing: "LW",
  rightWing: "RW",
  aft: "AF",
  wings: "WG",
  fuselage: "FS",
};
const FACING_ORDER: ReadonlyArray<FighterFacing> = [
  "nose",
  "leftWing",
  "rightWing",
  "aft",
  "wings",
  "fuselage",
];

/** Armor: TW / 4, round nearest, min 1 (0 if the facing is absent). */
function convertArmor(tw: number): number {
  return tw > 0 ? Math.max(1, roundNearest(tw / VEHICLE_ARMOR_DIVISOR)) : 0;
}

/** Notable equipment (ammo/gear) grouped by facing + label, with bin counts. */
function buildFighterEquipment(mounts: ReadonlyArray<FighterMount>): VehicleEquipment[] {
  const byKey = new Map<string, VehicleEquipment>();
  for (const m of mounts) {
    const lower = m.name.toLowerCase();
    const facing = FACING_CODE[m.facing];
    let label: string;
    let category: "ammo" | "equipment";
    let countable: boolean;
    if (lower.includes("ammo")) {
      label = ammoLabel(m.name);
      category = "ammo";
      countable = true;
    } else {
      const norm = normalizeWeaponName(m.name);
      const match = IMPORTANT_EQUIPMENT.find((e) => e.match.some((s) => lower.includes(s) || norm.includes(s)));
      if (!match) continue;
      label = match.label;
      category = "equipment";
      countable = match.countable ?? false;
    }
    const key = `${facing}|${category}|${label}`;
    const existing = byKey.get(key);
    if (existing) {
      if (countable) existing.count += 1;
    } else {
      byKey.set(key, { label, facing, category, count: 1 });
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      Number(a.category === "ammo") - Number(b.category === "ammo") || a.label.localeCompare(b.label),
  );
}

/**
 * Convert a parsed fighter into a Fighter Override card. Each facing's weapons
 * are grouped into TICs independently; ammo/gear keep their facing.
 */
export function convertFighter(unit: FighterUnit): FighterCard {
  const warnings: string[] = [];
  const otherMounts: FighterMount[] = [];
  const allWeapons: CardWeapon[] = []; // raw mounts (carry facing in rawLocation) for the TIC editor
  const allTics: Tic[] = [];
  const unknownWeapons = new Set<string>();

  for (const facing of FACING_ORDER) {
    const cardWeapons: CardWeapon[] = [];
    for (const mount of unit.mounts.filter((m) => m.facing === facing)) {
      // Capital-scale guns have no 'Mech-scale stats — drop them (no row, no warning).
      if (isWarshipWeapon(mount.name)) continue;
      const isAmmo = isNonWeaponMount(mount.name); // glued ammo + cargo + Narc pods
      const { unknown } = lookupWeaponDamage(mount.name, unit.techBase);
      // AMS / Laser AMS / TAG are equipment in Override, never weapons.
      const isEquipment = isWeaponBlockEquipment(mount.name);
      if (!isAmmo && !isEquipment && (!unknown || looksLikeWeapon(mount.name))) {
        const w: Weapon = {
          name: mount.name,
          location: FIGHTER_LOCATION,
          rawLocation: facing,
          rearMounted: mount.rear ?? false,
        };
        cardWeapons.push(convertWeapon(w, unit.techBase, 0));
        if (unknown) unknownWeapons.add(mount.name);
      } else {
        otherMounts.push(mount);
      }
    }
    allWeapons.push(...cardWeapons);
    allTics.push(...groupIntoTics(cardWeapons));
  }

  const weapons = fighterWeaponRows(allTics, unit.techBase);

  for (const name of unknownWeapons) {
    warnings.push(`weapon not in TW damage table: "${name}" (damage set to 0)`);
  }

  const a: FighterArmorRaw = unit.armor;
  const armor: FighterCardArmor = {
    nose: convertArmor(a.nose),
    rightWing: convertArmor(a.rightWing),
    leftWing: convertArmor(a.leftWing),
    aft: convertArmor(a.aft),
  };

  // Structural Integrity: a single airframe-wide value, by tonnage bracket (best-effort).
  const structure = vehicleStructure(unit.tonnage);

  // TMM is a SINGLE number: the higher (sprint) value of the 'Mech pair on max
  // thrust. VERIFIED vs DFA mockup: Aeshna safe 5 -> max 8 -> base 2 -> TMM 3.
  const tmm = lookupTmm(unit.maxThrust) + 1;

  // Override heat sinks: dissipation / 5 round nearest, like the 'Mech card.
  // VERIFIED: Aeshna 21 doubles -> 42 -> Sinks 8. Conventional fighters do not
  // track heat, so their sinks are 0 (the card omits the field + heat scale).
  const dissipation = unit.heatSinkCount * (unit.heatSinkType === "double" ? 2 : 1);
  const sinks = unit.conventional ? 0 : roundNearest(dissipation / 5);

  // Damage Threshold: (nose + aft + one wing) of the OVERRIDE armor / 30, round
  // nearest. Uses the already-reduced card armor (TW/4), NOT raw TW armor — on
  // the Override scale this lands at ~10% of a side's armor, matching the TW
  // Threshold relationship; floored at 1. Aeshna (21 + 14 + 16) / 30 = 1.7 -> DThr 2.
  const dthr = Math.max(1, roundNearest((armor.nose + armor.aft + Math.max(armor.leftWing, armor.rightWing)) / 30));

  return {
    kind: "fighter",
    name: `${unit.chassis} ${unit.model}`.trim(),
    chassis: unit.chassis,
    model: unit.model,
    techBase: unit.techBase,
    tonnage: unit.tonnage,
    conventional: unit.conventional,
    motionType: unit.motionType,
    move: `${unit.safeThrust} / ${unit.maxThrust}`,
    safeThrust: unit.safeThrust,
    maxThrust: unit.maxThrust,
    tmm,
    sinks,
    dthr,
    armor,
    armorType: unit.armorType,
    structure,
    fuel: unit.fuel,
    weapons,
    weaponMounts: allWeapons,
    tics: allTics,
    equipment: buildFighterEquipment(otherMounts),
    warnings,
    sourceFile: unit.sourceFile,
  };
}
