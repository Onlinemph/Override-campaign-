/**
 * Battle Armor conversion: `BattleArmorUnit` -> `BattleArmorCard`.
 *
 * PURE module. Reuses the 'Mech weapon engine wholesale (convertWeapon ->
 * groupIntoTics) and the equipment surfacing (buildEquipment); only the
 * armor/movement/TMM math is BA-specific.
 *
 * RULES STATUS: the armor and TMM conversions below MIRROR the 'Mech rules as a
 * best-effort starting point (chosen explicitly — see the project decision).
 * Each mirrored field is marked TODO(BA-rules) and should be validated against
 * the DFA generator's Battle Armor output before being trusted.
 */

import {
  ARM_LEG_ARMOR_DIVISOR,
  MIN_ARM_LEG_ARMOR,
  TMM_JUMP_BONUS,
} from "./constants.js";
import {
  abbreviateWeapon,
  buildEquipment,
  convertWeapon,
  formatDamage,
  groupIntoTics,
  isNonWeaponMount,
  lookupTmm,
  lookupWeaponDamage,
  looksLikeWeapon,
  normalizeWeaponName,
  roundNearest,
  scaleSquadDamage,
} from "./convert.js";
import type {
  BAFirepower,
  BattleArmorCard,
  BattleArmorUnit,
  CardWeapon,
  CritSlot,
  TechBase,
  Weapon,
} from "./types.js";

/** All BA weapons share one synthetic location so identical types TIC together. */
const BA_LOCATION = "CT" as const;

/** True if an item name looks like a weapon (so unknowns surface rather than drop). */
/**
 * True for anti-personnel infantry small arms (infantry rifles, Mauser systems,
 * or anything in the Anti-Personnel Mount). These do no meaningful damage to
 * BattleTech targets — they're abstracted by the card's anti-infantry column —
 * so the BA path ignores them entirely rather than listing them as weapons.
 *
 * @param name      the weapon name
 * @param mountTag  the BLK `:LOC` mount tag ("RA", "APM", …)
 */
function isAntiPersonnel(name: string, mountTag: string): boolean {
  // The mount tag can be the last `:LOC` segment, but some BLKs put the APM flag
  // in a MIDDLE segment ("Auto-Rifle:APM:RA"), so also look for it in the name.
  return mountTag.toUpperCase() === "APM" || /:\s*apm\b/i.test(name) || /infantry|mauser/i.test(name);
}

/**
 * BA armor TYPES (Reflective, Reactive, Mimetic, Fire-Resistant, Stealth) are
 * sometimes listed in the equipment blocks. They are not weapons — skip them so
 * they don't show as zero-damage "unknown weapons".
 */
function isBaArmorType(name: string): boolean {
  return /\b(reflective|reactive|mimetic)\b|fire[\s-]?resist|\bstealth\b/i.test(name);
}

/** Expand a mount into `copies` identical names (the squad's total of that item). */
function expand(name: string, copies: number): string[] {
  return Array.from({ length: Math.max(1, copies) }, () => name);
}

/**
 * Build the per-trooper firepower table: each distinct weapon, with its damage
 * scaled by surviving trooper count.
 *
 * BA does not use TICs. Every trooper fires their own copy, so for n survivors a
 * weapon's damage is that of (n × perTrooper) copies (see scaleSquadDamage). The
 * squad `weapons` array is already expanded to squad totals, so a weapon's
 * per-trooper count is its squad count ÷ troopers.
 */
function buildFirepower(weapons: CardWeapon[], troopers: number, techBase: TechBase): BAFirepower[] {
  const squadSize = Math.max(1, troopers);
  const groups = new Map<string, CardWeapon[]>();
  const order: string[] = [];
  for (const w of weapons) {
    const key = normalizeWeaponName(w.name);
    const existing = groups.get(key);
    if (existing) {
      existing.push(w);
    } else {
      groups.set(key, [w]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const members = groups.get(key)!;
    const rep = members[0]!;
    const perTrooper = Math.max(1, Math.round(members.length / squadSize));
    const byTrooper = Array.from({ length: squadSize }, (_, i) =>
      formatDamage(scaleSquadDamage(rep, (i + 1) * perTrooper)),
    );
    const abbrev = abbreviateWeapon(rep.name, techBase);
    return {
      label: perTrooper > 1 ? `${perTrooper}× ${abbrev}` : abbrev,
      perTrooper,
      unknown: rep.unknown,
      range: rep.range,
      rangeText: rep.rangeText,
      byTrooper,
    };
  });
}

/**
 * Convert a parsed BA squad into a Battle Armor Override card.
 *
 * Squad firepower: each mount is replicated across the squad (per-trooper gear
 * times trooper count). The card's `firepower` table then shows each distinct
 * weapon's damage by surviving trooper count — BA troopers each fire their own
 * copy, so damage is summed per suit rather than grouped under the 'Mech TIC
 * caps. `tics` is still computed (shared engine) but BA cards do not display it.
 */
export function convertBattleArmor(unit: BattleArmorUnit): BattleArmorCard {
  const warnings: string[] = [];

  // Split mounts into weapons (known, or weapon-looking) and everything else.
  const weaponNames: string[] = [];
  const otherSlots: CritSlot[] = [];
  const unknownWeapons = new Set<string>();

  for (const mount of unit.mounts) {
    // Anti-personnel infantry small arms are flavor in BattleTech (abstracted by
    // the anti-infantry column), so drop them entirely — no weapon, no warning.
    if (isAntiPersonnel(mount.name, mount.mount)) continue;
    // BA armor types (Reflective/Reactive/Mimetic/Stealth) are not weapons.
    if (isBaArmorType(mount.name)) continue;
    // Ammo and gear go through the equipment filter, never the weapon path —
    // even though an ammo line ("SRM 2 Ammo") contains a weapon-looking word.
    const isAmmo = isNonWeaponMount(mount.name); // glued ammo + cargo + Narc pods
    const { unknown } = lookupWeaponDamage(mount.name, unit.techBase);
    if (!isAmmo && (!unknown || looksLikeWeapon(mount.name))) {
      weaponNames.push(...expand(mount.name, mount.copies));
      if (unknown) unknownWeapons.add(mount.name);
    } else {
      // Non-weapon gear -> route through the same ammo/important-equipment filter
      // the 'Mech path uses; a synthetic crit slot per copy keeps bin counts right.
      for (const name of expand(mount.name, mount.copies)) {
        otherSlots.push({ name, location: BA_LOCATION, rawLocation: mount.mount || "Squad" });
      }
    }
  }

  const weapons: CardWeapon[] = weaponNames.map((name) => {
    const w: Weapon = {
      name,
      location: BA_LOCATION,
      rawLocation: "Squad",
      rearMounted: false,
    };
    return convertWeapon(w, unit.techBase, 0);
  });

  for (const name of unknownWeapons) {
    warnings.push(`weapon not in TW damage table: "${name}" (damage set to 0)`);
  }

  // Armor: mirror the 'Mech arm/leg rule (TW / 3, round nearest, min 1).
  // TODO(BA-rules): BA armor likely uses its own table — validate vs DFA.
  const armor = unit.armorPerTrooper
    ? Math.max(MIN_ARM_LEG_ARMOR, roundNearest(unit.armorPerTrooper / ARM_LEG_ARMOR_DIVISOR))
    : 0;

  // TMM: mirror the 'Mech run-MP table, keyed on the squad's fastest mode.
  // TODO(BA-rules): BA TMM is set by its own movement rules — validate vs DFA.
  const fastest = Math.max(unit.walkMP, unit.jumpMP);
  const tmm = lookupTmm(fastest);

  const move = `${unit.walkMP}${unit.jumpMP > 0 ? `/${unit.jumpMP} (J)` : ""}`;

  return {
    kind: "battlearmor",
    name: `${unit.chassis} ${unit.model}`.trim(),
    chassis: unit.chassis,
    model: unit.model,
    techBase: unit.techBase,
    troopers: unit.troopers,
    weightClass: unit.weightClass,
    move,
    walkMP: unit.walkMP,
    jumpMP: unit.jumpMP,
    motionType: unit.motionType,
    tmm,
    tmmJump: tmm + TMM_JUMP_BONUS,
    armorPerTrooper: unit.armorPerTrooper,
    armor,
    // Each suit can take one final hit once its armor is gone (the trooper's
    // single structure point) — drawn as the red "health" hex on the card.
    health: 1,
    weapons,
    tics: groupIntoTics(weapons),
    firepower: buildFirepower(weapons, unit.troopers, unit.techBase),
    antiInfantryByTrooper: Array.from({ length: unit.troopers }, (_, i) => `${i + 1}d6`),
    equipment: buildEquipment(otherSlots),
    // PA(L) exoskeletons cannot make anti-'Mech attacks; everything else can.
    // TODO(BA-rules): refine (e.g. some configs/quads) once verified.
    antiMech: unit.weightClass !== "PA(L)",
    warnings,
    sourceFile: unit.sourceFile,
  };
}
