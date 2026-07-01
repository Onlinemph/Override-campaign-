/**
 * DropShip conversion: `DropshipUnit` -> `DropshipCard`.
 *
 * PURE module. Built on the aerospace-fighter rules (per the user's direction —
 * "same rules as before"): armor = TW/4 (round nearest, min 1), Sinks =
 * dissipation/5, DThr = (nose + aft + one side) OVERRIDE armor / 30, TMM = the single
 * higher (sprint) value on max thrust. Weapons reuse the shared engine, grouped
 * into TICs PER ARC (Nose / Left Side / Right Side / Aft; Hull mounts are
 * equipment). SI comes from the BLK <structural_integrity> at TW/3 (round
 * nearest, min 1) — best-effort, no DFA dropship oracle yet.
 *
 * Capital / sub-capital weapons have no Override stats yet; they list as
 * unknown (0 damage) with a warning until rules are supplied.
 */

import { IMPORTANT_EQUIPMENT, VEHICLE_ARMOR_DIVISOR, STRUCTURE_DIVISOR } from "./constants.js";
import {
  ammoLabel,
  buildTic,
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
  DropshipCard,
  DropshipFacing,
  DropshipMount,
  DropshipUnit,
  TechBase,
  Tic,
  VehicleEquipment,
  VehicleWeaponRow,
  Weapon,
} from "./types.js";

/** Rebuild the per-arc weapon rows from TICs (shared by the converter and the TIC
 * editor), in arc order. Each TIC is already one weapon bay, so no further
 * collapsing — two identical bays are two separate attacks and stay two rows. */
export function dropshipWeaponRows(tics: ReadonlyArray<Tic>, techBase: TechBase): VehicleWeaponRow[] {
  const order = (t: Tic) => ARC_ORDER.indexOf(t.weapons[0]!.rawLocation as DropshipFacing);
  return [...tics]
    .sort((a, b) => order(a) - order(b))
    .map((t) => {
      const w0 = t.weapons[0]!;
      // A rear-mounted side bay is a spheroid's aft sub-arc: show e.g. "LS (R)".
      const code = ARC_CODE[w0.rawLocation as DropshipFacing] + (w0.rearMounted ? " (R)" : "");
      return ticRow(t, techBase, code);
    });
}

/** All dropship weapons share a synthetic 'Mech location; grouping is per arc. */
const SYNTH_LOCATION = "CT" as const;

/** Arc -> short code shown on the card (Loc column / equipment). */
const ARC_CODE: Readonly<Record<DropshipFacing, string>> = {
  nose: "NO",
  leftSide: "LS",
  rightSide: "RS",
  aft: "AF",
  hull: "HL",
  // WarShip arcs.
  foreLeft: "FL",
  foreRight: "FR",
  aftLeft: "AL",
  aftRight: "AR",
  leftBroad: "LB",
  rightBroad: "RB",
};
const ARC_ORDER: ReadonlyArray<DropshipFacing> = [
  "nose",
  "foreLeft",
  "foreRight",
  "leftBroad",
  "rightBroad",
  "aftLeft",
  "aftRight",
  "aft",
  "leftSide",
  "rightSide",
  "hull",
];

/** Armor: TW / divisor, round nearest, min 1 (0 if the arc is absent).
 * DropShips use VEHICLE_ARMOR_DIVISOR (4). WarShip BLK armor is ALREADY
 * capital-scale (1/10 of TW); Override drops it further by /3 (per the user). */
function convertArmor(tw: number, divisor: number): number {
  return tw > 0 ? Math.max(1, roundNearest(tw / divisor)) : 0;
}

/** Notable equipment (ammo / gear) grouped by arc + label, with bin counts. */
function buildDropshipEquipment(mounts: ReadonlyArray<DropshipMount>): VehicleEquipment[] {
  const byKey = new Map<string, VehicleEquipment>();
  for (const m of mounts) {
    const lower = m.name.toLowerCase();
    const facing = ARC_CODE[m.facing] + (m.rear ? " (R)" : "");
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

/** Convert a parsed DropShip into a DropShip Override card. */
export function convertDropship(unit: DropshipUnit): DropshipCard {
  const warnings: string[] = [];
  const otherMounts: DropshipMount[] = [];
  const allWeapons: CardWeapon[] = []; // raw mounts (carry the arc in rawLocation) for the TIC editor
  const allTics: Tic[] = [];
  const unknownWeapons = new Set<string>();

  // Convert one mount into `into`, or divert it. Capital / sub-capital weapons
  // have no 'Mech-scale stats yet, but their bays are SHOWN (as "?") so the
  // layout is visible — they don't count as accidentally-"missing" weapons.
  // Hull mounts / ammo / gear / unrecognised non-weapons go to the equipment line.
  const takeWeapon = (mount: DropshipMount, into: CardWeapon[]): void => {
    const arc = mount.facing;
    const capital = isWarshipWeapon(mount.name); // capital/sub-capital scale, deferred
    const { unknown } = lookupWeaponDamage(mount.name, unit.techBase);
    if (
      arc === "hull" ||
      isNonWeaponMount(mount.name) ||
      isWeaponBlockEquipment(mount.name) ||
      (unknown && !looksLikeWeapon(mount.name) && !capital)
    ) {
      otherMounts.push(mount);
      return;
    }
    const w: Weapon = { name: mount.name, location: SYNTH_LOCATION, rawLocation: arc, rearMounted: mount.rear ?? false };
    into.push(convertWeapon(w, unit.techBase, 0, unit.shipClass === "WarShip"));
    if (unknown && !capital) unknownWeapons.add(mount.name); // capital is deferred, not "missing"
  };

  if (unit.mounts.some((m) => m.bay !== undefined)) {
    // Bay-aware BLK: each weapon bay (the "(B)" group) becomes ONE TIC, summed
    // across the bay with no 'Mech TIC caps — a WarShip-scale bay can be huge.
    const bays = new Map<number, DropshipMount[]>();
    for (const m of unit.mounts) {
      const arr = bays.get(m.bay!) ?? [];
      arr.push(m);
      bays.set(m.bay!, arr);
    }
    for (const id of [...bays.keys()].sort((a, b) => a - b)) {
      const bayWeapons: CardWeapon[] = [];
      for (const mount of bays.get(id)!) takeWeapon(mount, bayWeapons);
      if (bayWeapons.length > 0) {
        allWeapons.push(...bayWeapons);
        allTics.push(buildTic(bayWeapons));
      }
    }
  } else {
    // Markerless BLK: fall back to auto-grouping identical weapons per arc.
    for (const arc of ARC_ORDER) {
      const cardWeapons: CardWeapon[] = [];
      for (const mount of unit.mounts.filter((m) => m.facing === arc)) takeWeapon(mount, cardWeapons);
      allWeapons.push(...cardWeapons);
      allTics.push(...groupIntoTics(cardWeapons));
    }
  }

  for (const name of unknownWeapons) {
    warnings.push(`weapon not in TW damage table: "${name}" (damage set to 0)`);
  }

  const collapsed = dropshipWeaponRows(allTics, unit.techBase);

  const a = unit.armor;
  const armorDivisor = unit.shipClass === "WarShip" ? 3 : VEHICLE_ARMOR_DIVISOR;
  const conv = (tw: number | undefined) => (tw === undefined ? undefined : convertArmor(tw, armorDivisor));
  const armor = {
    nose: convertArmor(a.nose, armorDivisor),
    leftSide: convertArmor(a.leftSide, armorDivisor),
    rightSide: convertArmor(a.rightSide, armorDivisor),
    aft: convertArmor(a.aft, armorDivisor),
    foreLeft: conv(a.foreLeft),
    foreRight: conv(a.foreRight),
    aftLeft: conv(a.aftLeft),
    aftRight: conv(a.aftRight),
  };

  // SI: the BLK carries the TW value; card scale = /3 round nearest, min 1.
  const structure = Math.max(1, roundNearest(unit.structuralIntegrity / STRUCTURE_DIVISOR));

  // TMM: single higher (sprint) value on max thrust, as on the fighter card.
  const tmm = lookupTmm(unit.maxThrust) + 1;

  // Sinks: dissipation / 5 round nearest (doubles sink 2 each).
  const dissipation = unit.heatSinkCount * (unit.heatSinkType === "double" ? 2 : 1);
  const sinks = roundNearest(dissipation / 5);

  // DThr: (nose + aft + one side) of the OVERRIDE armor / 30, round nearest —
  // the already-reduced card armor (TW/4), NOT raw TW armor (~10% of a side on
  // the Override scale); floored at 1.
  const dthr = Math.max(1, roundNearest((armor.nose + armor.aft + Math.max(armor.leftSide, armor.rightSide)) / 30));

  return {
    kind: "dropship",
    shipClass: unit.shipClass,
    name: `${unit.chassis} ${unit.model}`.trim(),
    chassis: unit.chassis,
    model: unit.model,
    techBase: unit.techBase,
    tonnage: unit.tonnage,
    motionLabel: /aerodyne/i.test(unit.motionType) ? "Aerodyne" : "Spheroid",
    move: `${unit.safeThrust} / ${unit.maxThrust}`,
    safeThrust: unit.safeThrust,
    maxThrust: unit.maxThrust,
    tmm,
    sinks,
    dthr,
    armor,
    armorType: unit.armorType,
    structure,
    weapons: collapsed,
    weaponMounts: allWeapons,
    tics: allTics,
    equipment: buildDropshipEquipment(otherMounts),
    bays: unit.bays,
    warnings,
    sourceFile: unit.sourceFile,
  };
}
