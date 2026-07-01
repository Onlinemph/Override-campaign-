/**
 * Combat Vehicle conversion: `VehicleUnit` -> `VehicleCard`.
 *
 * PURE module. Reuses the 'Mech weapon engine: weapons are grouped into TICs
 * PER FACING (front/turret/sides/rear stay separate), then abbreviated and
 * heat-rated exactly like the 'Mech card.
 *
 * Numbers are tuned against the DFA Manticore Heavy Tank card (60t, armor
 * 42/33/33/26/42): armor = TW/4 (verified), structure by tonnage bracket
 * (verified), TMM = base/+1 on flank MP, move shows the motion letter ("4 / 6t").
 * TMM is still best-effort - keep validating new vehicles against DFA.
 *
 * VTOLs share this card. They add a rotor location (the 5th armor value) and a
 * flying move (motion letter "v"); a turret, if present, is the 6th armor value.
 */

import {
  IMPORTANT_EQUIPMENT,
  MOTION_TYPE_LETTER,
  RUN_MP_MULTIPLIER,
  VEHICLE_ARMOR_DIVISOR,
  vehicleStructure,
} from "./constants.js";
import {
  ammoLabel,
  convertWeapon,
  groupIntoTics,
  isNonWeaponMount,
  isWeaponBlockEquipment,
  lookupTmm,
  lookupWeaponDamage,
  looksLikeWeapon,
  moveBoostFactor,
  normalizeWeaponName,
  roundNearest,
  roundUp,
  ticRow,
} from "./convert.js";
import type {
  CardWeapon,
  TechBase,
  Tic,
  VehicleCard,
  VehicleCardArmor,
  VehicleEquipment,
  VehicleFacing,
  VehicleMount,
  VehicleUnit,
  VehicleWeaponRow,
  Weapon,
} from "./types.js";

/** Rebuild the per-facing weapon rows from TICs (shared by the converter and the
 * TIC editor), in canonical facing order. */
export function vehicleWeaponRows(tics: ReadonlyArray<Tic>, techBase: TechBase): VehicleWeaponRow[] {
  const order = (t: Tic) => FACING_ORDER.indexOf(t.weapons[0]!.rawLocation as VehicleFacing);
  return [...tics]
    .sort((a, b) => order(a) - order(b))
    .map((t) => ticRow(t, techBase, FACING_CODE[t.weapons[0]!.rawLocation as VehicleFacing]));
}

/** All vehicle weapons share one synthetic location; grouping is scoped per facing. */
const VEHICLE_LOCATION = "CT" as const;

/** Facing -> short code shown on the card (Loc column / equipment). */
const FACING_CODE: Readonly<Record<VehicleFacing, string>> = {
  front: "FR",
  turret: "TU",
  right: "RS",
  left: "LS",
  rear: "RR",
  rotor: "RO",
  body: "BD",
};
const FACING_ORDER: ReadonlyArray<VehicleFacing> = [
  "front",
  "turret",
  "right",
  "left",
  "rear",
  "rotor",
  "body",
];

/** Armor: TW / 4, round nearest, min 1 (0 if the facing is absent). */
function convertArmor(tw: number): number {
  return tw > 0 ? Math.max(1, roundNearest(tw / VEHICLE_ARMOR_DIVISOR)) : 0;
}

/** Notable equipment (ammo/gear) grouped by facing + label, with bin counts. */
function buildVehicleEquipment(mounts: ReadonlyArray<VehicleMount>): VehicleEquipment[] {
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
 * Convert a parsed combat vehicle into a Vehicle Override card. Each facing's
 * weapons are grouped into TICs independently; ammo/gear keep their facing.
 */
export function convertVehicle(unit: VehicleUnit): VehicleCard {
  const warnings: string[] = [];
  const otherMounts: VehicleMount[] = [];
  const allWeapons: CardWeapon[] = []; // raw mounts (carry facing in rawLocation) for the TIC editor
  const allTics: Tic[] = [];
  const unknownWeapons = new Set<string>();

  for (const facing of FACING_ORDER) {
    const cardWeapons: CardWeapon[] = [];
    for (const mount of unit.mounts.filter((m) => m.facing === facing)) {
      const isAmmo = isNonWeaponMount(mount.name); // glued ammo + cargo + Narc pods
      const { unknown } = lookupWeaponDamage(mount.name, unit.techBase);
      // AMS / Laser AMS / TAG are equipment in Override, never weapons.
      const isEquipment = isWeaponBlockEquipment(mount.name);
      if (!isAmmo && !isEquipment && (!unknown || looksLikeWeapon(mount.name))) {
        const w: Weapon = {
          name: mount.name,
          location: VEHICLE_LOCATION,
          rawLocation: facing,
          rearMounted: false,
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

  const weapons = vehicleWeaponRows(allTics, unit.techBase);

  for (const name of unknownWeapons) {
    warnings.push(`weapon not in TW damage table: "${name}" (damage set to 0)`);
  }

  const a = unit.armor;
  const armor: VehicleCardArmor = {
    front: convertArmor(a.front),
    right: convertArmor(a.right),
    left: convertArmor(a.left),
    rear: convertArmor(a.rear),
    ...(unit.hasTurret ? { turret: convertArmor(a.turret ?? 0) } : {}),
    ...(unit.hasRotor ? { rotor: convertArmor(a.rotor ?? 0) } : {}),
  };

  // Internal structure per facing (uniform), by tonnage bracket (verified vs DFA).
  const structure = vehicleStructure(unit.tonnage);

  // MASC / Supercharger boost (Override house rule): scale cruise, then
  // re-derive flank as cruise × 1.5. Detected from the equipment mounts.
  const boost = moveBoostFactor(unit.mounts.map((m) => m.name));
  const cruiseMP = boost > 1 ? roundUp(unit.cruiseMP * boost) : unit.cruiseMP;
  const flankMP = boost > 1 ? roundUp(cruiseMP * RUN_MP_MULTIPLIER) : unit.flankMP;
  // TMM mirrors the 'Mech run table on flank MP; card prints `tmm / tmm+1`.
  const tmm = lookupTmm(flankMP);
  const letter = MOTION_TYPE_LETTER[unit.motionType.toLowerCase()] ?? "";

  return {
    kind: "vehicle",
    name: `${unit.chassis} ${unit.model}`.trim(),
    chassis: unit.chassis,
    model: unit.model,
    techBase: unit.techBase,
    tonnage: unit.tonnage,
    motionType: unit.motionType,
    move: `${cruiseMP} / ${flankMP}${letter}`,
    cruiseMP,
    flankMP,
    tmm,
    armor,
    armorType: unit.armorType,
    structure,
    hasTurret: unit.hasTurret,
    hasRotor: unit.hasRotor,
    ...(unit.support ? { support: true } : {}),
    weapons,
    weaponMounts: allWeapons,
    tics: allTics,
    equipment: buildVehicleEquipment(otherMounts),
    warnings,
    sourceFile: unit.sourceFile,
  };
}
