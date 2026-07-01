import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  abbreviateWeapon,
  ammoShotsPerTon,
  buildTic,
  classifyDamage,
  computeDamageProfile,
  computeRangeBrackets,
  computeVariableProfile,
  convertUnit,
  convertWeapon,
  detectWeaponTech,
  formatDamage,
  scaleSquadDamage,
  formatRangeBrackets,
  isLegalTic,
  isMissileWeapon,
  isRangeVaryingCluster,
  isRocketLauncher,
  isWeaponBlockEquipment,
  isNonWeaponMount,
  isWarshipWeapon,
  lookupHeadArmor,
  lookupTmm,
  lookupWeaponDamage,
  lookupWeaponHeat,
  normalizeWeaponName,
  parseMtf,
  roundNearest,
  roundUp,
  ticHeat,
  WEAPON_DAMAGE_BY_RANGE,
  WEAPON_RANGES,
  WEAPON_RANGES_CLAN,
} from "../src/core/index.js";
import type { TechBase } from "../src/core/index.js";
import type { OverrideCard } from "../src/core/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const card = (name: string): OverrideCard =>
  convertUnit(parseMtf(readFileSync(join(FIXTURES, name), "utf8"), name));

/** Run a single weapon name through the full damage path, mirroring convertWeapon. */
const damageTextFor = (name: string, tech: TechBase = "IS"): string => {
  const key = normalizeWeaponName(name);
  const { twDamage, unknown } = lookupWeaponDamage(name, tech);
  const byRange = WEAPON_DAMAGE_BY_RANGE[key];
  const profile =
    !unknown && byRange
      ? computeVariableProfile(byRange)
      : computeDamageProfile(
          twDamage,
          unknown ? "direct" : classifyDamage(key),
          isRangeVaryingCluster(key),
          isRocketLauncher(key),
        );
  return formatDamage(profile);
};

// NOTE: expected values below are hand-computed from the formulas in
// convert.ts against the embedded fixtures. They are the FIRST-PASS values to
// be cross-checked against DFA-generated cards (see README). Replace with the
// corrected expected values once supplied.

describe("rounding helpers", () => {
  it("roundUp rounds toward +Infinity", () => {
    expect(roundUp(1.01)).toBe(2);
    expect(roundUp(1.667)).toBe(2);
    expect(roundUp(2)).toBe(2);
  });
  it("roundNearest rounds .5 up", () => {
    expect(roundNearest(4.333)).toBe(4);
    expect(roundNearest(8.667)).toBe(9);
    expect(roundNearest(2.5)).toBe(3);
  });
});

describe("lookupTmm (keyed on RUN MP, verified vs DFA)", () => {
  it("matches the verified data points", () => {
    expect(lookupTmm(3)).toBe(0);
    expect(lookupTmm(5)).toBe(1); // Atlas anchor
    expect(lookupTmm(6)).toBe(1);
    expect(lookupTmm(8)).toBe(2);
    expect(lookupTmm(9)).toBe(2);
    expect(lookupTmm(11)).toBe(3);
    expect(lookupTmm(12)).toBe(3);
  });
  it("applies the inferred upper bands", () => {
    expect(lookupTmm(17)).toBe(4);
    expect(lookupTmm(18)).toBe(5);
  });
});

describe("lookupHeadArmor (bracketed on head TW, cap 5)", () => {
  it("matches the bracket table", () => {
    expect(lookupHeadArmor(0)).toBe(1);
    expect(lookupHeadArmor(2)).toBe(1);
    expect(lookupHeadArmor(5)).toBe(2);
    expect(lookupHeadArmor(7)).toBe(3);
    expect(lookupHeadArmor(9)).toBe(4);
    expect(lookupHeadArmor(12)).toBe(5);
  });
});

describe("ammoShotsPerTon (canonical rounds per ton)", () => {
  it("reads autocannon class, including LB-X / Ultra / Rotary / Light AC", () => {
    expect(ammoShotsPerTon("IS Ammo AC/2")).toBe(45);
    expect(ammoShotsPerTon("IS Ammo AC/5")).toBe(20);
    expect(ammoShotsPerTon("IS Ammo AC/10")).toBe(10);
    expect(ammoShotsPerTon("IS Ammo AC/20")).toBe(5);
    expect(ammoShotsPerTon("IS Ammo LAC/5")).toBe(20);
    expect(ammoShotsPerTon("ISRotaryAC5 Ammo")).toBe(20);
    expect(ammoShotsPerTon("Clan Ultra AC/10 Ammo")).toBe(10);
    expect(ammoShotsPerTon("IS LB 10-X AC Ammo")).toBe(10);
    expect(ammoShotsPerTon("ISLBXAC10 Ammo")).toBe(10);
    expect(ammoShotsPerTon("IS LB 20-X Cluster Ammo")).toBe(5);
  });
  it("reads missile rack sizes (LRM/SRM/Streak/MML/ATM/MRM)", () => {
    expect(ammoShotsPerTon("IS Ammo LRM-5")).toBe(24);
    expect(ammoShotsPerTon("IS Ammo LRM-20")).toBe(6);
    expect(ammoShotsPerTon("IS Ammo SRM-2")).toBe(50);
    expect(ammoShotsPerTon("IS Streak SRM 6 Ammo")).toBe(15);
    expect(ammoShotsPerTon("IS Ammo MML-5 LRM")).toBe(24);
    expect(ammoShotsPerTon("IS Ammo MML-5 SRM")).toBe(20);
    expect(ammoShotsPerTon("Clan Ammo ATM-6")).toBe(10);
    expect(ammoShotsPerTon("IS Ammo Extended LRM-15")).toBe(6);
  });
  it("handles Gauss family, MG, plasma, AMS, and one-shot", () => {
    expect(ammoShotsPerTon("IS Gauss Ammo")).toBe(8);
    expect(ammoShotsPerTon("IS Light Gauss Ammo")).toBe(16);
    expect(ammoShotsPerTon("ISHeavyGauss Ammo")).toBe(4);
    expect(ammoShotsPerTon("Hyper-Assault Gauss Rifle/20 Ammo")).toBe(6);
    expect(ammoShotsPerTon("IS Ammo MG - Full")).toBe(200);
    expect(ammoShotsPerTon("ISPlasmaRifleAmmo")).toBe(10);
    expect(ammoShotsPerTon("ISAMS Ammo")).toBe(12);
    expect(ammoShotsPerTon("CLSRM2 (OS) Ammo")).toBe(1);
  });
  it("returns undefined for ammo without a canonical per-ton count", () => {
    expect(ammoShotsPerTon("Cargo")).toBeUndefined();
    expect(ammoShotsPerTon("Coolant Pod")).toBeUndefined();
  });
});

describe("normalizeWeaponName", () => {
  it("normalizes spelling variants to TW table keys", () => {
    expect(normalizeWeaponName("Autocannon/20")).toBe("ac/20");
    expect(normalizeWeaponName("AC/20")).toBe("ac/20");
    expect(normalizeWeaponName("ISAC20")).toBe("ac/20");
    expect(normalizeWeaponName("ISMediumLaser")).toBe("medium laser");
    expect(normalizeWeaponName("Medium Laser")).toBe("medium laser");
    expect(normalizeWeaponName("LRM 20")).toBe("lrm 20");
    expect(normalizeWeaponName("SRM-6")).toBe("srm 6");
    expect(normalizeWeaponName("1 Small Laser")).toBe("small laser");
  });

  it("strips a tech prefix glued before the lowercase improved-marker (iATM)", () => {
    // The "i" is lowercase, so the plain CL/IS strip (which needs an uppercase
    // next char) used to leave "c li atm 12". iATM shares the ATM stat block.
    expect(normalizeWeaponName("CLiATM12:OMNI")).toBe("atm 12");
    expect(normalizeWeaponName("CLiATM9")).toBe("atm 9");
    expect(normalizeWeaponName("ISiATM6")).toBe("atm 6");
    expect(lookupWeaponDamage("CLiATM12", "Clan").unknown).toBe(false);
  });

  it("strips the MegaMek CLBA/ISBA Battle Armor prefix", () => {
    // After stripping CL+BA the name falls through to the shared weapon table.
    expect(normalizeWeaponName("CLBAERSmallLaser")).toBe("er small laser");
    expect(normalizeWeaponName("CLBAFlamer")).toBe("flamer");
    expect(normalizeWeaponName("CLBAHeavySmallLaser")).toBe("heavy small laser");
    expect(normalizeWeaponName("CLBAHeavyMediumLaser")).toBe("heavy medium laser");
    expect(normalizeWeaponName("ISBAERSmallLaser")).toBe("er small laser");
    expect(normalizeWeaponName("ISBAMediumLaser")).toBe("medium laser");
  });

  it("expands the MG abbreviation and strips trailing OS", () => {
    expect(normalizeWeaponName("CLBAMG")).toBe("machine gun");
    expect(normalizeWeaponName("CLBAHeavyMG")).toBe("heavy machine gun");
    expect(normalizeWeaponName("CLBALightMG")).toBe("light machine gun");
    expect(normalizeWeaponName("CLAdvancedSRM2OS")).toBe("advanced srm 2");
    expect(normalizeWeaponName("CLBASRM2 (OS)")).toBe("srm 2"); // parens-style still works
  });

  it("strips the [BA] suffix from display-name style entries", () => {
    expect(normalizeWeaponName("Flamer [BA]")).toBe("flamer");
    expect(normalizeWeaponName("BA Support PPC")).toBe("support ppc");
  });
});

describe("lookupWeaponDamage (TW values, tech-base aware)", () => {
  it("returns shared/IS values by default", () => {
    expect(lookupWeaponDamage("Medium Laser")).toEqual({ twDamage: 5, unknown: false });
    expect(lookupWeaponDamage("Gauss Rifle")).toEqual({ twDamage: 15, unknown: false });
    expect(lookupWeaponDamage("Streak SRM 6")).toEqual({ twDamage: 12, unknown: false });
    expect(lookupWeaponDamage("MRM 40")).toEqual({ twDamage: 40, unknown: false });
  });
  it("disambiguates ER weapons by tech base", () => {
    expect(lookupWeaponDamage("ER PPC", "IS").twDamage).toBe(10);
    expect(lookupWeaponDamage("ER PPC", "Clan").twDamage).toBe(15);
    expect(lookupWeaponDamage("ER Large Laser", "IS").twDamage).toBe(8);
    expect(lookupWeaponDamage("ER Large Laser", "Clan").twDamage).toBe(10);
    expect(lookupWeaponDamage("ER Medium Laser", "Clan").twDamage).toBe(7);
  });
  it("falls back to the shared table for Clan units when no override exists", () => {
    expect(lookupWeaponDamage("AC/20", "Clan").twDamage).toBe(20);
  });
  it("flags unknown weapons", () => {
    expect(lookupWeaponDamage("Death Ray")).toEqual({ twDamage: 0, unknown: true });
  });

  it("resolves Streak weapons to their non-streak counterpart, keeping tech + label", () => {
    // Streak LRMs were unknown; now share the LRM stats (Clan/IS divide intact).
    expect(lookupWeaponDamage("Streak LRM 15", "IS").twDamage).toBe(15);
    expect(lookupWeaponDamage("CLStreakLRM10", "Clan").twDamage).toBe(10);
    expect(normalizeWeaponName("Streak SRM 6")).toBe("srm 6");
    // Label keeps the "S" (and Clan "c"); glued names too.
    expect(abbreviateWeapon("Streak LRM 15", "IS")).toBe("SLRM-15");
    expect(abbreviateWeapon("CLStreakLRM10", "Clan")).toBe("cSLRM-10");
  });

  it("scores Battle Armor support guns from their BLK names (VERIFIED vs DFA mockup)", () => {
    expect(lookupWeaponDamage("ISBADavidLightGaussRifle").twDamage).toBe(1);
    expect(lookupWeaponDamage("ISBAKingDavidLightGaussRifle").twDamage).toBe(1);
    expect(lookupWeaponDamage("ISBATsunamiHeavyGaussRifle").twDamage).toBe(1);
    expect(lookupWeaponDamage("ISBALightRecoillessRifle").twDamage).toBe(2);
    // "MagshotGR" now normalizes to the existing magshot entry (was unknown).
    expect(lookupWeaponDamage("ISBAMagshotGR").twDamage).toBe(2);
    expect(normalizeWeaponName("ISBAMagshotGR")).toBe("magshot gauss rifle");
  });
});

describe("missile damage profile (M dice, VERIFIED vs DFA cards)", () => {
  it("classifies missile families, excluding direct-fire weapons", () => {
    expect(isMissileWeapon("lrm 15")).toBe(true);
    expect(isMissileWeapon("srm 6")).toBe(true);
    expect(isMissileWeapon("streak srm 6")).toBe(true); // leading "streak srm", not "srm"
    expect(isMissileWeapon("mrm 40")).toBe(true);
    expect(isMissileWeapon("rocket launcher 10")).toBe(true);
    expect(isMissileWeapon("medium laser")).toBe(false);
    expect(isMissileWeapon("ac/20")).toBe(false);
    expect(isMissileWeapon("gauss rifle")).toBe(false);
  });

  it("derives base/mDice/max for every confirmed card line", () => {
    // [rackTW, expected "base+M{mDice} (max)"] — exactly the DFA card screenshots.
    const cases: Array<[number, string]> = [
      [5, "1+M1 (2)"], // LRM-5
      [10, "1+M1 (4)"], // LRM-10 / MRM-10
      [15, "1+M2 (5)"], // LRM-15 / RL15
      [20, "2+M2 (7)"], // LRM-20 / MRM-20
      [4, "1+M1 (2)"], // SRM-2 / Streak SRM-2
      [8, "1+M1 (3)"], // SRM-4 / Streak SRM-4
      [12, "1+M2 (4)"], // SRM-6 / Streak SRM-6
      [30, "3+M3 (10)"], // MRM-30
      [40, "4+M4 (14)"], // MRM-40
    ];
    for (const [tw, expected] of cases) {
      expect(formatDamage(computeDamageProfile(tw, "missile"))).toBe(expected);
    }
  });

  it("leaves direct-fire weapons flat (base === max, no dice)", () => {
    expect(computeDamageProfile(5, "direct")).toEqual({
      kind: "direct",
      base: 2,
      mDice: 0,
      cDice: [],
      byRange: [],
      max: 2,
    }); // Medium Laser
    expect(formatDamage(computeDamageProfile(20, "direct"))).toBe("7"); // AC/20
  });

  it("rounds Rocket Launcher max to nearest (RL10 -> 3, not 4)", () => {
    // All three RLs VERIFIED vs DFA card; RL10 would be 4 under ceil.
    expect(damageTextFor("Rocket Launcher 10")).toBe("1+M1 (3)");
    expect(damageTextFor("Rocket Launcher 15")).toBe("1+M2 (5)");
    expect(damageTextFor("Rocket Launcher 20")).toBe("2+M2 (7)");
  });

  it("renders missile damageText through full conversion (Atlas LRM-20 + SRM-6)", () => {
    const c = card("Atlas AS7-D.mtf");
    const text = c.weapons.map((w) => w.damageText);
    // AC/20 flat 7, LRM-20 -> 2+M2 (7), SRM-6 -> 1+M2 (4), 4x ML flat 2.
    expect(text).toEqual(["7", "2+M2 (7)", "1+M2 (4)", "2", "2", "2", "2"]);
  });
});

describe("cluster damage profile (C dice, VERIFIED vs DFA card)", () => {
  it("classifies cluster families (LB-X, HAG), not missiles or direct-fire", () => {
    expect(classifyDamage("lb 10-x ac")).toBe("cluster");
    expect(classifyDamage("hag/30")).toBe("cluster"); // slash-delimited family token
    expect(classifyDamage("lrm 15")).toBe("missile");
    expect(classifyDamage("medium laser")).toBe("direct");
    expect(isRangeVaryingCluster("hag/30")).toBe(true);
    expect(isRangeVaryingCluster("lb 10-x ac")).toBe(false);
  });

  it("derives base+C{cDice} where base + cDice === max", () => {
    expect(formatDamage(computeDamageProfile(10, "cluster"))).toBe("1+C3"); // LB 10-X, VERIFIED
    expect(formatDamage(computeDamageProfile(20, "cluster"))).toBe("2+C5"); // LB 20-X
  });

  it("sheds one C die per bracket for range-varying clusters (HAG)", () => {
    expect(formatDamage(computeDamageProfile(30, "cluster", true))).toBe("3+C7|6|5"); // HAG/30, VERIFIED
    expect(computeDamageProfile(30, "cluster", true)).toEqual({
      kind: "cluster",
      base: 3,
      mDice: 0,
      cDice: [7, 6, 5],
      byRange: [],
      max: 10,
    });
  });

  it("renders verified damage lines through full conversion", () => {
    // LB 10-X cluster, RL15 missile (+M2), RAC/5 and UAC/10 flat, all from the card.
    expect(damageTextFor("LB 10-X AC")).toBe("1+C3");
    expect(damageTextFor("LB 10-X AC", "Clan")).toBe("1+C3"); // cLB 10-X same
    expect(damageTextFor("Rotary AC/5")).toBe("3"); // TW 8 -> ceil/3
    expect(damageTextFor("Ultra AC/10")).toBe("4"); // TW 10 -> ceil/3
    expect(damageTextFor("Ultra AC/20", "Clan")).toBe("7"); // cUAC/20 TW 20 -> ceil/3
    expect(damageTextFor("HAG/30", "Clan")).toBe("3+C7|6|5");
  });
});

describe("TIC grouping (page 41 caps: base <= 5, max <= 14)", () => {
  const W = (name: string, location: string, rearMounted = false) => ({
    name,
    location: location as never,
    rawLocation: location,
    rearMounted,
  });
  const ticsFor = (weapons: ReturnType<typeof W>[], mass = 55) =>
    convertUnit({
      chassis: "T",
      model: "1",
      mass,
      techBase: "IS",
      config: "Biped",
      engine: { rating: 275, type: "Fusion" },
      movement: { walkMP: 5, runMP: 8, jumpMP: 0, runDerived: true },
      heatSinks: { count: 10, type: "single" },
      armor: { CT: 10 },
      structure: {},
      weapons,
    }).tics;

  it("groups identical weapons in the same location, summing TW", () => {
    const tics = ticsFor([W("Medium Laser", "LA"), W("Medium Laser", "LA")]);
    expect(tics).toHaveLength(1);
    expect(tics[0]!.label).toBe("2x Medium Laser"); // TW 10 -> ceil/3 = 4
    expect(tics[0]!.damageText).toBe("4");
  });

  it("does not group across different locations", () => {
    const tics = ticsFor([W("Medium Laser", "LA"), W("Medium Laser", "RA")]);
    expect(tics).toHaveLength(2);
    expect(tics.every((t) => t.count === 1)).toBe(true);
  });

  it("splits a group when the base cap (5) would be exceeded", () => {
    // 4 Medium Lasers: TW 20 -> max 7, base 7 > 5. Largest legal group is 3 (TW 15 -> 5).
    const tics = ticsFor([0, 1, 2, 3].map(() => W("Medium Laser", "RA")));
    expect(tics.map((t) => t.count)).toEqual([3, 1]);
    expect(tics[0]!.damageText).toBe("5");
    expect(tics[1]!.damageText).toBe("2");
  });

  it("splits missiles when the max cap (14) would be exceeded", () => {
    // 3 LRM-15: TW 45 -> max 15 > 14. Legal pair (TW 30 -> 3+M3 (10)) + single.
    const tics = ticsFor([0, 1, 2].map(() => W("LRM 15", "LT")));
    expect(tics.map((t) => t.count)).toEqual([2, 1]);
    // Identical-weapon group scales the single profile by count (matches the
    // printed card): 2x LRM-15 -> base 1*2, M 2*2, max ceil(30/3).
    expect(tics[0]!.damageText).toBe("2+M4 (10)");
    expect(tics[1]!.damageText).toBe("1+M2 (5)");
  });

  it("keeps an over-cap single weapon as its own legal TIC (Heavy Gauss)", () => {
    const tics = ticsFor([W("Heavy Gauss Rifle", "RT")]);
    expect(tics).toHaveLength(1);
    expect(tics[0]!.count).toBe(1);
    expect(tics[0]!.damageText).toBe("9|7|4"); // variable, never grouped
  });

  it("buildTic combines a same-kind group and reports legality", () => {
    const ws = convertUnit({
      chassis: "T", model: "1", mass: 55, techBase: "IS", config: "Biped",
      engine: { rating: 275, type: "Fusion" },
      movement: { walkMP: 5, runMP: 8, jumpMP: 0, runDerived: true },
      heatSinks: { count: 10, type: "single" }, armor: { CT: 10 }, structure: {},
      weapons: [W("LRM 10", "LT"), W("LRM 5", "LT")],
    }).weapons;
    const tic = buildTic(ws);
    expect(tic.damageText).toBe("1+M2 (5)"); // TW 15 combined
    expect(tic.label).toBe("LRM 10 + LRM 5"); // different names
    expect(tic.rangeText).toBe("+4 +2 +0 +2 +4"); // both LRM, same range
    expect(isLegalTic(ws)).toBe(true);
  });

  it("buildTic: a mixed-RANGE bay falls off with range (out-of-range weapons drop out)", () => {
    const w = (name: string) => convertWeapon({ name, location: "CT", rearMounted: false }, "IS", 0);
    // 2 Large Lasers (reach Long) + 2 Medium Lasers (stop at Medium).
    const tic = buildTic([w("Large Laser"), w("Large Laser"), w("Medium Laser"), w("Medium Laser")]);
    // Short/Med: all four (TW 26 -> 9); Long: only the Large Lasers (TW 16 -> 6).
    expect(tic.damageText).toBe("9|9|6");
    expect(tic.rangeText).toBe("+0 +0 +2 +4 –"); // the longest-reaching member's envelope
    expect(tic.label).toBe("2x Large Laser + 2x Medium Laser");
  });

  it("isLegalTic: single over-cap weapon legal; cross-location illegal", () => {
    const ws = convertUnit({
      chassis: "T", model: "1", mass: 55, techBase: "IS", config: "Biped",
      engine: { rating: 275, type: "Fusion" },
      movement: { walkMP: 5, runMP: 8, jumpMP: 0, runDerived: true },
      heatSinks: { count: 10, type: "single" }, armor: { CT: 10 }, structure: {},
      weapons: [W("Heavy Gauss Rifle", "RT"), W("Medium Laser", "LA")],
    }).weapons;
    expect(isLegalTic([ws[0]!])).toBe(true); // over-cap single allowed
    expect(isLegalTic(ws)).toBe(false); // different locations
  });

  it("converts the Atlas into per-location TICs", () => {
    const c = card("Atlas AS7-D.mtf");
    // 4 Medium Lasers: 2 in arms (LA, RA -> separate), 2 rear in CT -> grouped.
    const ml = c.tics.filter((t) => t.label.includes("Medium Laser"));
    const grouped = ml.find((t) => t.count === 2);
    expect(grouped?.location).toBe("CT");
    expect(grouped?.rearMounted).toBe(true);
    expect(grouped?.damageText).toBe("4"); // 2x ML: TW 10 -> ceil(10/3) = 4
  });
});

describe("equipment surfacing (ammo + important gear from crit slots)", () => {
  const c = card("Atlas AS7-D (crits).mtf");
  const find = (label: string) => c.equipment.find((e) => e.label === label);

  it("counts ammo bins, collapsing torso sections onto one Torso (CT)", () => {
    // CT/LT/RT all merge to CT — Override has only one "Torso".
    expect(find("AC/20 Ammo")).toMatchObject({ location: "CT", category: "ammo", count: 2 });
    expect(find("LRM-20 Ammo")).toMatchObject({ location: "CT", category: "ammo", count: 2 });
    expect(find("SRM-6 Ammo")).toMatchObject({ location: "CT", category: "ammo", count: 1 });
  });

  it("surfaces important gear (CASE, ECM) at the collapsed Torso, once each", () => {
    expect(find("CASE")).toMatchObject({ location: "CT", category: "equipment", count: 1 });
    expect(find("ECM")).toMatchObject({ location: "CT", category: "equipment", count: 1 });
  });

  it("excludes weapons, actuators, engine, and structure from equipment", () => {
    const labels = c.equipment.map((e) => e.label);
    expect(labels).not.toContain("Medium Laser");
    expect(labels).not.toContain("Autocannon/20");
    expect(labels.some((l) => /actuator|engine|gyro|sensors|life support/i.test(l))).toBe(false);
  });

  it("orders equipment before ammo", () => {
    const firstAmmo = c.equipment.findIndex((e) => e.category === "ammo");
    const lastEquip = c.equipment.map((e) => e.category).lastIndexOf("equipment");
    expect(lastEquip).toBeLessThan(firstAmmo);
  });

  it("is empty when the MTF has no crit blocks", () => {
    expect(card("Atlas AS7-D.mtf").equipment).toEqual([]);
  });
});

describe("melee (Punch/Kick auto-generated + physical weapons)", () => {
  it("derives Punch/Kick from tonnage (VERIFIED 100t -> 4/7)", () => {
    expect(card("Atlas AS7-D.mtf").melee).toEqual({ punch: 4, kick: 7 }); // 100t
    expect(card("Hunchback HBK-4G.mtf").melee).toEqual({ punch: 2, kick: 4 }); // 50t
    expect(card("Locust LCT-1V.mtf").melee).toEqual({ punch: 1, kick: 2 }); // 20t
  });

  it("converts physical melee weapons from tonnage with a PB-only to-hit mod", () => {
    // Hatchet on a 100t 'Mech: ceil(100/15)=7, PB +0 only.
    const u = parseMtf(
      readFileSync(join(FIXTURES, "Atlas AS7-D.mtf"), "utf8"),
      "Atlas AS7-D.mtf",
    );
    const withHatchet = convertUnit({
      ...u,
      weapons: [{ name: "Hatchet", location: "RA", rawLocation: "Right Arm", rearMounted: false }],
    });
    const hatchet = withHatchet.weapons[0]!;
    expect(hatchet.damageText).toBe("7");
    expect(hatchet.rangeText).toBe("-1 – – – –"); // PB -1 (DFA)
  });

  it("surfaces a melee weapon found only in the crit slots (not the Weapons block)", () => {
    // MegaMek lists a Hatchet only in the limb crit slots (often as several
    // contiguous "(OMNIPOD)" slots), never in the Weapons block — like the Rime
    // Otter C. The converter should still produce ONE Hatchet weapon.
    const u = parseMtf(readFileSync(join(FIXTURES, "Atlas AS7-D.mtf"), "utf8"), "Atlas AS7-D.mtf");
    const c = convertUnit({
      ...u,
      weapons: [],
      critSlots: [
        { name: "Hatchet (OMNIPOD)", location: "LA", rawLocation: "Left Arm" },
        { name: "Hatchet (OMNIPOD)", location: "LA", rawLocation: "Left Arm" },
        { name: "Hatchet (OMNIPOD)", location: "LA", rawLocation: "Left Arm" },
      ],
    });
    const hatchets = c.weapons.filter((w) => /hatchet/i.test(w.name));
    expect(hatchets).toHaveLength(1); // the 3 slots collapse to one weapon
    expect(hatchets[0]!.damageText).toBe("7"); // 100t -> ceil(100/15)
  });

  it("does not double-count a melee weapon that IS declared in the Weapons block", () => {
    const u = parseMtf(readFileSync(join(FIXTURES, "Atlas AS7-D.mtf"), "utf8"), "Atlas AS7-D.mtf");
    const c = convertUnit({
      ...u,
      weapons: [{ name: "Hatchet", location: "RA", rawLocation: "Right Arm", rearMounted: false }],
      critSlots: [{ name: "Hatchet", location: "RA", rawLocation: "Right Arm" }],
    });
    expect(c.weapons.filter((w) => /hatchet/i.test(w.name))).toHaveLength(1);
  });

  it("uses the DFA point-blank to-hit modifier per melee weapon", () => {
    const pb = (name: string) =>
      convertWeapon({ name, location: "RA", rearMounted: false }, "IS", 50).rangeText!.split(" ")[0];
    expect(pb("Hatchet")).toBe("-1");
    expect(pb("Sword")).toBe("-2");
    expect(pb("Mace")).toBe("+1");
    expect(pb("Claws")).toBe("+1");
    expect(pb("Lance")).toBe("+1");
  });

  it("handles the rest of the physical-weapon family (blade, vibro, industrial, taser)", () => {
    const w = (name: string, mass = 50) =>
      convertWeapon({ name, location: "RA", rearMounted: false }, "IS", mass);
    // Retractable Blade is mass-based (50t -> ceil(50/30) = 2), point-blank only.
    expect(w("1 Retractable Blade")).toMatchObject({ damageText: "2", rangeText: "+0 – – – –", unknown: false });
    // Fixed-damage melee, point-blank with the physical to-hit modifier.
    expect(w("ISSmallVibroBlade")).toMatchObject({ damageText: "3", rangeText: "-1 – – – –" });
    expect(w("Backhoe")).toMatchObject({ damageText: "2", rangeText: "+1 – – – –" });
    expect(w("MiningDrill")).toMatchObject({ damageText: "2", rangeText: "+0 – – – –" });
    // The Taser family unifies to a SPECIAL-effect weapon (incl. BA Taser).
    for (const n of ["BattleMech Taser", "Mech Taser", "ISMekTaser", "ISBATaser"]) {
      expect(w(n)).toMatchObject({ damageText: "SPECIAL", unknown: false });
    }
  });
});

describe("jump as its own movement mode (TMM = jump bracket + 1)", () => {
  const base = parseMtf(readFileSync(join(FIXTURES, "Atlas AS7-D.mtf"), "utf8"), "Atlas AS7-D.mtf");
  const jump = (jumpMP: number) =>
    convertUnit({ ...base, movement: { walkMP: 4, runMP: 6, jumpMP, runDerived: true } }).tmmJump;

  it("uses the normal movement bracket for the jump distance, +2", () => {
    expect(jump(5)).toBe(3); // lookupTmm(5)=1 -> +2
    expect(jump(6)).toBe(3); // lookupTmm(6)=1 -> +2
    expect(jump(7)).toBe(4); // lookupTmm(7)=2 -> +2
    expect(jump(3)).toBe(2); // lookupTmm(3)=0 -> +2
  });

  it("is 0 when the unit can't jump", () => {
    expect(jump(0)).toBe(0);
  });
});

describe("MASC / Supercharger movement boost", () => {
  const base = parseMtf(readFileSync(join(FIXTURES, "Atlas AS7-D.mtf"), "utf8"), "Atlas AS7-D.mtf");
  const boosted = (walkMP: number, critNames: string[]) =>
    convertUnit({
      ...base,
      movement: { walkMP, runMP: Math.ceil(walkMP * 1.5), jumpMP: 0, runDerived: true },
      critSlots: critNames.map((name) => ({ name, location: "CT", rawLocation: "Center Torso" })),
    });

  it("scales walk ×1.5 with BOTH MASC and Supercharger (Walk 5 -> 8/12, like the Rime Otter)", () => {
    const c = boosted(5, ["CLMASC", "Supercharger (Clan) (OMNIPOD)"]);
    expect(c.walkMove).toBe(8); // ceil(5 * 1.5)
    expect(c.runMove).toBe(12); // ceil(8 * 1.5)
    expect(c.move).toBe("8/12");
    expect(c.tmm).toBe(3); // run 12 -> higher bracket
  });

  it("scales walk ×1.25 with a single device (Walk 5 -> 7/11)", () => {
    expect(boosted(5, ["ISMASC"]).move).toBe("7/11"); // ceil(5*1.25)=7, ceil(7*1.5)=11
    expect(boosted(5, ["Supercharger"]).move).toBe("7/11");
  });

  it("leaves movement unchanged without either device", () => {
    const c = boosted(5, ["Double Heat Sink"]);
    expect(c.walkMove).toBe(5);
    expect(c.runMove).toBe(8);
  });
});

describe("variable (range-dependent) damage (VERIFIED vs DFA card)", () => {
  it("classifies and formats short|med|long damage", () => {
    expect(classifyDamage("snub-nose ppc")).toBe("variable");
    expect(classifyDamage("heavy gauss rifle")).toBe("variable");
    expect(formatDamage(computeVariableProfile([10, 8, 5]))).toBe("4|3|2"); // SNPPC
    expect(formatDamage(computeVariableProfile([25, 20, 10]))).toBe("9|7|4"); // Heavy Gauss
  });

  it("renders through the full conversion path", () => {
    expect(damageTextFor("Snub-Nose PPC")).toBe("4|3|2");
    expect(damageTextFor("Heavy Gauss Rifle")).toBe("9|7|4");
  });

  it("exposes per-range values with min as base and short as max", () => {
    expect(computeVariableProfile([25, 20, 10])).toEqual({
      kind: "variable",
      base: 4,
      mDice: 0,
      cDice: [],
      byRange: [9, 7, 4],
      max: 9,
    });
  });
});

describe("range brackets (page 43, VERIFIED vs DFA cards)", () => {
  const brackets = (key: string) => formatRangeBrackets(computeRangeBrackets(WEAPON_RANGES[key]!));

  it("reproduces the missile card rows exactly", () => {
    expect(brackets("lrm 15")).toBe("+4 +2 +0 +2 +4"); // min 6 -> Short +2 (>=4)
    expect(brackets("srm 6")).toBe("+0 +0 +2 – –");
    expect(brackets("streak srm 6")).toBe("+0 +0 +2 – –");
    expect(brackets("mrm 10")).toBe("+1 +1 +3 +5 –"); // inherent +1 layered on
  });

  it("layers the MRM inherent +1 only on applicable brackets (X stays –)", () => {
    expect(computeRangeBrackets(WEAPON_RANGES["mrm 40"]!)).toEqual({
      pb: 1,
      s: 1,
      m: 3,
      l: 5,
      x: null,
    });
  });

  it("derives sensible brackets for canonical direct-fire weapons", () => {
    expect(brackets("medium laser")).toBe("+0 +0 +2 – –"); // 0/6/9
    expect(brackets("large laser")).toBe("+0 +0 +2 +4 –"); // 0/10/15
    expect(brackets("ppc")).toBe("+2 +0 +2 +4 –"); // min 3 -> PB +2, S +0
    expect(brackets("ac/2")).toBe("+4 +2 +0 +2 +4"); // min 4, long 24
    expect(brackets("ac/20")).toBe("+0 +0 +2 – –"); // 0/6/9
    expect(brackets("gauss rifle")).toBe("+2 +0 +0 +2 +4"); // min 2, med 15, long 22
  });

  it("the Short bracket follows min>=4, not literal ==4", () => {
    expect(computeRangeBrackets({ min: 6, medium: 14, long: 21 }).s).toBe(2); // LRM
    expect(computeRangeBrackets({ min: 3, medium: 12, long: 18 }).s).toBe(0); // PPC
    expect(computeRangeBrackets({ min: 4, medium: 16, long: 24 }).s).toBe(2); // AC/2
  });

  it("reproduces every verified row from the mixed-weapons DFA card", () => {
    expect(brackets("medium pulse laser")).toBe("-2 -2 +2 – –"); // pulse -2
    expect(brackets("er medium laser")).toBe("+0 +0 +2 +4 –"); // IS, long 13
    expect(brackets("lb 10-x ac")).toBe("+0 +0 +2 +4 –");
    expect(brackets("hag/30")).toBe("+2 +0 +0 +2 +4");
    expect(brackets("rotary ac/5")).toBe("+0 +0 +2 +4 –"); // IS
    expect(brackets("ultra ac/10")).toBe("+0 +0 +2 +4 –"); // IS
    expect(brackets("rocket launcher 15")).toBe("+1 +1 +3 +5 –"); // inherent +1
  });

  it("reproduces the IS rows from the mixed 100-ton DFA card", () => {
    expect(brackets("small pulse laser")).toBe("-2 -2 – – –"); // SPLas
    expect(brackets("large pulse laser")).toBe("-2 -2 +0 – –"); // LPLas
    expect(brackets("er small laser")).toBe("+0 +0 +4 – –"); // erSLas
    expect(brackets("er large laser")).toBe("+0 +0 +0 +2 +4"); // erLLas IS
    expect(brackets("snub-nose ppc")).toBe("+0 +0 +0 +4 –"); // SNPPC
    expect(brackets("heavy gauss rifle")).toBe("+4 +2 +0 +2 +4"); // HGauss
    expect(brackets("rotary ac/2")).toBe("+0 +0 +2 +4 –"); // RAC/2
    expect(brackets("ultra ac/20")).toBe("+0 +0 +2 – –"); // cUAC/20
  });

  it("reproduces the batch-7 weapon mockup rows exactly (dmg / range / abbrev)", () => {
    const row = (name: string, tech: TechBase = "IS") => {
      const w = convertWeapon({ name, location: "RA", rearMounted: false }, tech, 50);
      return { dmg: w.damageText, rng: w.rangeText, ab: abbreviateWeapon(name, tech) };
    };
    // Existing stats that were only failing on normalization (now resolve).
    expect(row("Light Auto Cannon/5")).toEqual({ dmg: "2", rng: "+0 +0 +2 +4 –", ab: "LAC/5" });
    expect(row("Light Auto Cannon/2")).toEqual({ dmg: "1", rng: "+0 +0 +2 +4 –", ab: "LAC/2" });
    expect(row("ISSNPPC")).toEqual({ dmg: "4|3|2", rng: "+0 +0 +0 +4 –", ab: "SNPPC" });
    expect(row("Medium VSP").dmg).toBe("3|3|2"); // "Medium VSP" -> "medium vsp laser"
    // New weapons from the mockup.
    expect(row("Small VSP Laser")).toEqual({ dmg: "2|2|1", rng: "-3 -3 +2 – –", ab: "vsSPLas" });
    expect(row("ProtoMech AC/8", "Clan")).toEqual({ dmg: "3", rng: "+0 +0 +2 – –", ab: "cPMAC/8" });
    expect(row("ISImprovedHeavyGaussRifle")).toEqual({ dmg: "8", rng: "+2 +0 +2 +2 +4", ab: "iHGauss" });
    expect(row("ER Small Pulse Laser", "Clan")).toEqual({ dmg: "2", rng: "-1 -1 +3 – –", ab: "erSPLas" });
    expect(row("Binary Laser (Blazer) Cannon")).toEqual({ dmg: "4", rng: "+0 +0 +2 +4 –", ab: "Blazer" });
    expect(row("Blazer Cannon").dmg).toBe("4"); // alias folds onto "binary laser cannon"
  });

  it("mirrors torpedoes onto their missile counterpart (LRT=LRM, SRT=SRM), keeping the Clan divide", () => {
    expect(normalizeWeaponName("LRT 15")).toBe("lrm 15");
    expect(normalizeWeaponName("SRT 4")).toBe("srm 4");
    expect(normalizeWeaponName("CLLRT20")).toBe("lrm 20");
    expect(damageTextFor("LRT 15")).toBe(damageTextFor("LRM 15"));
    expect(damageTextFor("SRT 6", "Clan")).toBe(damageTextFor("SRM 6", "Clan"));
    // The raw torpedo name is preserved for display even though stats come from LRM.
    const w = convertWeapon({ name: "LRT 15", location: "LT", rearMounted: false }, "IS", 50);
    expect(w.name).toBe("LRT 15");
    expect(w.unknown).toBe(false);
  });

  it("files anti-infantry/anti-BA pods under equipment, not the weapons table", () => {
    expect(isWeaponBlockEquipment("M-Pod")).toBe(true);
    expect(isWeaponBlockEquipment("B-Pod")).toBe(true);
    expect(isWeaponBlockEquipment("Anti-BattleArmor Pods (B-Pods)")).toBe(true);
    expect(isWeaponBlockEquipment("ISAntiPersonnelPod")).toBe(true);
  });

  it("reproduces the batch-8 mockup rows (Narc launchers, Chem lasers, ProtoMech AC)", () => {
    const row = (name: string, tech: TechBase = "IS") => {
      const w = convertWeapon({ name, location: "RA", rearMounted: false }, tech, 50);
      return { dmg: w.damageText, rng: w.rangeText, ab: abbreviateWeapon(name, tech), unk: w.unknown };
    };
    // Narc launchers: 0 damage, but a real range row (they tag, not hit).
    expect(row("iNarc")).toEqual({ dmg: "0", rng: "+0 +0 +2 +4 –", ab: "iNarc", unk: false });
    expect(row("ISNarcBeacon", "Clan")).toEqual({ dmg: "0", rng: "+0 +0 +2 – –", ab: "cNarc", unk: false });
    expect(row("Compact Narc")).toEqual({ dmg: "0", rng: "+0 +0 +4 – –", ab: "Compact Narc", unk: false });
    // Chemical lasers (Small/Medium make no heat; Large makes 1).
    expect(row("Small Chem Laser", "Clan")).toMatchObject({ dmg: "1", rng: "+0 +0 – – –" });
    expect(row("CLMediumChemicalLaser", "Clan")).toMatchObject({ dmg: "2", rng: "+0 +0 +2 – –" });
    expect(row("Large Chem Laser", "Clan")).toMatchObject({ dmg: "3", rng: "+0 +0 +2 +4 –" });
    // ProtoMech AC/4 verified; AC/2 from the same range progression.
    expect(row("ProtoMech AC/4", "Clan")).toEqual({ dmg: "2", rng: "+0 +0 +2 +4 –", ab: "cPMAC/4", unk: false });
    expect(row("ProtoMech AC/2", "Clan").dmg).toBe("1");
  });

  it("reproduces the batch-9 mockup rows (SBGauss, HFlamer, Enhanced LRM, HVAC, Prototype ER ML)", () => {
    const row = (name: string, tech: TechBase = "IS") => {
      const w = convertWeapon({ name, location: "RA", rearMounted: false }, tech, 50);
      return { dmg: w.damageText, rng: w.rangeText, ht: Math.round(lookupWeaponHeat(name) / 5) };
    };
    expect(row("Silver Bullet Gauss Rifle")).toEqual({ dmg: "1+C4", rng: "+2 -1 -1 +1 +3", ht: 0 });
    expect(row("Heavy Flamer")).toEqual({ dmg: "2+H1", rng: "+0 +0 – – –", ht: 1 });
    // Enhanced LRM = standard LRM damage, with its own (shared) range bands.
    expect(row("Enhanced LRM 5")).toEqual({ dmg: "1+M1 (2)", rng: "+2 +0 +0 +2 +4", ht: 0 });
    expect(row("Enhanced LRM 20").rng).toBe("+2 +0 +0 +2 +4"); // every class shares the bands
    expect(damageTextFor("Enhanced LRM 15")).toBe(damageTextFor("LRM 15"));
    // Hyper-Velocity AC.
    expect(row("Hyper Velocity Auto Cannon/2")).toEqual({ dmg: "1", rng: "+2 +0 +0 +0 +2", ht: 1 });
    expect(row("Hyper Velocity Auto Cannon/5")).toEqual({ dmg: "2", rng: "+0 +0 +0 +2 +2", ht: 1 });
    expect(row("Hyper Velocity Auto Cannon/10")).toEqual({ dmg: "4", rng: "+0 +0 +2 +2 +4", ht: 1 });
    // Prototype ER Medium Laser = IS ER Medium Laser, even on a Clan unit (Clan ER
    // ML would be 3; the prototype stays at the IS value of 2).
    expect(row("Prototype ER Medium Laser", "IS")).toEqual({ dmg: "2", rng: "+0 +0 +2 +4 –", ht: 1 });
    expect(convertWeapon({ name: "Prototype ER Medium Laser", location: "RA", rearMounted: false }, "Clan", 50).damageText).toBe("2");
  });

  it("reproduces the batch-10 mockup (improved heavy lasers, artillery cannons, re-eng small)", () => {
    const row = (name: string, tech: TechBase = "IS") => {
      const w = convertWeapon({ name, location: "RA", rearMounted: false }, tech, 50);
      return { dmg: w.damageText, rng: w.rangeText, ht: Math.round(lookupWeaponHeat(name) / 5), unk: w.unknown };
    };
    // Improved Heavy lasers: already in the table; MegaMek's word order now folds in.
    expect(row("CLImprovedSmallHeavyLaser", "Clan")).toEqual({ dmg: "2", rng: "+0 +0 – – –", ht: 1, unk: false });
    expect(row("CLImprovedMediumHeavyLaser", "Clan")).toEqual({ dmg: "4", rng: "+0 +0 +2 – –", ht: 1, unk: false });
    expect(row("CLImprovedLargeHeavyLaser", "Clan")).toEqual({ dmg: "6", rng: "+0 +0 +2 +4 –", ht: 4, unk: false });
    // Small Re-engineered Laser (-1 to-hit, point-blank).
    expect(row("Small Re-engineered Laser")).toEqual({ dmg: "2", rng: "-1 -1 – – –", ht: 1, unk: false });
    // Artillery cannons (rvmissile) + Thumper artillery piece (flat +4).
    expect(row("Long Tom Cannon")).toEqual({ dmg: "3+M2 (7)", rng: "+2 +0 +0 +2 +4", ht: 4, unk: false });
    expect(row("Sniper Cannon")).toEqual({ dmg: "2+M1 (4)", rng: "+2 +0 +2 – –", ht: 2, unk: false });
    expect(row("Thumper")).toEqual({ dmg: "2+M2 (5)", rng: "– +4 +4 +4 +4", ht: 1, unk: false });
  });

  it("standard bookkeeping: MagShot, I-OS, prototype RL, and non-weapon mounts", () => {
    // "MagShot" splits to "mag shot" — rejoined so it picks up its gauss stats.
    expect(normalizeWeaponName("MagShot")).toBe("magshot");
    expect(damageTextFor("MagShot")).toBe("1");
    // I-OS (Improved One-Shot) shares the base launcher's stats.
    expect(normalizeWeaponName("ISSRM2IOS")).toBe("srm 2");
    // Prototype Rocket Launchers mirror the production launcher.
    expect(normalizeWeaponName("CLRocketLauncher15Prototype")).toBe("rocket launcher 15");
    // A genuine prototype weapon is NOT collapsed onto its production cousin.
    expect(normalizeWeaponName("Prototype ER Medium Laser")).toBe("prototype er medium laser");
    // Ammo/cargo/Narc-pod lines are not weapons (glued spellings included).
    expect(isNonWeaponMount("ISPlasmaRifleAmmo")).toBe(true);
    expect(isNonWeaponMount("CLPlasmaCannonAmmo:OMNI")).toBe(true);
    expect(isNonWeaponMount("1 Cargo (1 ton)")).toBe(true);
    expect(isNonWeaponMount("ISNarc Pods")).toBe(true);
    expect(isNonWeaponMount("Medium Laser")).toBe(false);
  });

  it("resolves glued BLK aliases and equipment that previously surfaced as unknown", () => {
    // Glued abbreviations / word-order variants mirror their known weapon.
    expect(normalizeWeaponName("ISLPPC")).toBe("light ppc");
    expect(normalizeWeaponName("ISSBGR")).toBe("silver bullet gauss rifle");
    expect(normalizeWeaponName("Autocannon/10 Primitive")).toBe("ac/10");
    expect(normalizeWeaponName("CLERMediumLaserPrototype")).toBe("prototype er medium laser");
    expect(normalizeWeaponName("Prototype Rocket Launcher 20")).toBe("rocket launcher 20");
    expect(lookupWeaponDamage("ISLPPC").unknown).toBe(false);
    expect(lookupWeaponDamage("ISSBGR").unknown).toBe(false);
    // Glued equipment de-glues to match the equipment tokens (no longer a weapon).
    for (const n of ["ISMGA", "1 ISLMGA", "CLMGA:OMNI", "ISMPod", "1 CLBPod", "CLLightActiveProbe", "ISLaserInsulator", "1 Lift Hoist"]) {
      expect(isWeaponBlockEquipment(n)).toBe(true);
    }
  });

  it("flags capital/sub-capital/screen weapons (and their ammo) as warship-scale", () => {
    expect(isWarshipWeapon("Capital Missile Launcher (AR10 Launcher)")).toBe(true);
    expect(isWarshipWeapon("Sub-Capital Cannon (Heavy)")).toBe(true);
    expect(isWarshipWeapon("Sub-Capital Laser (SCL/1)")).toBe(true);
    expect(isWarshipWeapon("(B) Screen Launcher")).toBe(true);
    expect(isWarshipWeapon("Ammo AR10 Killer Whale")).toBe(true);
    expect(isWarshipWeapon("Sub-Capital Missile Launcher (Piranha)")).toBe(true);
    // 'Mech-scale weapons are not warship-scale.
    expect(isWarshipWeapon("Gauss Rifle")).toBe(false);
    expect(isWarshipWeapon("ER PPC")).toBe(false);
  });

  it("reproduces the BA weapon mockup (per-trooper degradation + brackets)", () => {
    // Per-trooper squad damage at 6..1 troopers = ceil(troopers * perTrooperTW / 3).
    const degrade = (name: string, tech: TechBase = "IS") => {
      const rep = convertWeapon({ name, location: "X", rearMounted: false }, tech, 0);
      return {
        rng: rep.rangeText,
        dmg: [6, 5, 4, 3, 2, 1].map((t) => formatDamage(scaleSquadDamage(rep, t))).join(" "),
        unk: rep.unknown,
      };
    };
    // New from the mockup: point-blank needler/grenades (TW 1), Heavy Mortar (TW 3).
    expect(degrade("ISBAFiredrakeIncendiaryNeedler")).toEqual({ rng: "+0 – – – –", dmg: "2 2 2 1 1 1", unk: false });
    expect(degrade("ISBAFireDrakeNeedler").dmg).toBe("2 2 2 1 1 1"); // alt spelling folds in
    expect(degrade("CLBAHeavyGrenadeLauncher")).toMatchObject({ rng: "+0 – – – –", dmg: "2 2 2 1 1 1" });
    expect(degrade("ISBAMicroGrenadeLauncher")).toMatchObject({ rng: "+0 – – – –", dmg: "2 2 2 1 1 1" });
    expect(degrade("ISBAHeavyMortar")).toEqual({ rng: "+2 +0 +4 – –", dmg: "6 5 4 3 2 1", unk: false });
    // "Same as mech" weapons: the BA prefix is stripped, keeping the IS/Clan divide.
    expect(degrade("BACLERMediumPulseLaser", "Clan").unk).toBe(false); // BACL double-prefix fixed
    expect(degrade("ISBACompactNarc").unk).toBe(false); // 0-damage tagger
    expect(degrade("ISBAHeavyFlamer").unk).toBe(false);
  });

  it("reproduces the BA Rocket Launcher mockup (RL1-3 direct, RL4 missile, +1/+1/+3/–)", () => {
    const degrade = (name: string) => {
      const rep = convertWeapon({ name, location: "X", rearMounted: false }, "IS", 0);
      return {
        rng: rep.rangeText,
        dmg: [6, 5, 4, 3, 2, 1].map((t) => formatDamage(scaleSquadDamage(rep, t))).join(" "),
        unk: rep.unknown,
      };
    };
    expect(degrade("ISBARL1")).toEqual({ rng: "+1 +1 +3 – –", dmg: "2 2 2 1 1 1", unk: false });
    expect(degrade("ISBARL2")).toEqual({ rng: "+1 +1 +3 – –", dmg: "4 4 3 2 2 1", unk: false });
    expect(degrade("ISBARL3")).toEqual({ rng: "+1 +1 +3 – –", dmg: "6 5 4 3 2 1", unk: false });
    // RL4 prints as a missile (M dice), unlike RL1-3.
    expect(degrade("ISBARL4")).toEqual({
      rng: "+1 +1 +3 – –",
      dmg: "6+M6 (8) 5+M5 (7) 4+M4 (6) 3+M3 (4) 2+M2 (3) 1+M1 (2)",
      unk: false,
    });
    expect(degrade("BARL1").dmg).toBe("2 2 2 1 1 1"); // glued/no-IS spelling folds in
  });

  it("reproduces the BA Grenade Launcher + MRM mockup (direct, full MRM range)", () => {
    const degrade = (name: string) => {
      const rep = convertWeapon({ name, location: "X", rearMounted: false }, "IS", 0);
      return {
        rng: rep.rangeText,
        dmg: [6, 5, 4, 3, 2, 1].map((t) => formatDamage(scaleSquadDamage(rep, t))).join(" "),
        unk: rep.unknown,
      };
    };
    expect(degrade("ISBAGrenadeLauncher")).toEqual({ rng: "+0 – – – –", dmg: "2 2 2 1 1 1", unk: false });
    expect(degrade("ISBAMRM1")).toEqual({ rng: "+1 +1 +3 +5 –", dmg: "2 2 2 1 1 1", unk: false });
    expect(degrade("ISBAMRM2")).toEqual({ rng: "+1 +1 +3 +5 –", dmg: "4 4 3 2 2 1", unk: false });
    expect(degrade("ISBAMRM3")).toEqual({ rng: "+1 +1 +3 +5 –", dmg: "6 5 4 3 2 1", unk: false });
    // The single-digit remap must NOT touch full-size 'Mech MRMs (still a missile).
    expect(normalizeWeaponName("MRM 10")).toBe("mrm 10");
    expect(degrade("MRM 10").dmg).toContain("+M"); // mech MRM keeps its M dice
  });

  it("applies Clan range overrides where TW ranges diverge", () => {
    const clan = (key: string) =>
      formatRangeBrackets(computeRangeBrackets(WEAPON_RANGES_CLAN[key]!));
    expect(clan("er small laser")).toBe("+0 +0 +4 – –"); // cerSLas 0/4/6
    expect(clan("er medium laser")).toBe("+0 +0 +2 +4 –"); // cerMLas 0/10/15
    expect(clan("er large laser")).toBe("+0 +0 +0 +2 +2"); // cerLLas 0/15/25 (X +2, not +4)
    expect(clan("medium pulse laser")).toBe("-2 -2 +0 – –"); // cMPLas 0/8/12
    expect(clan("rotary ac/5")).toBe("+0 +0 +0 +2 +4"); // cRAC/5 0/16/24
  });

  it("confirms tech-independent ranges resolve identically for IS and Clan units", () => {
    // cLB 10-X and cerPPC matched IS on the card -> no Clan override needed.
    expect(WEAPON_RANGES_CLAN["lb 10-x ac"]).toBeUndefined();
    expect(WEAPON_RANGES_CLAN["er ppc"]).toBeUndefined();
    expect(brackets("lb 10-x ac")).toBe("+0 +0 +2 +4 –");
    expect(brackets("er ppc")).toBe("+0 +0 +0 +2 +4");
  });

  it("attaches range rows through full conversion and leaves unlisted weapons null", () => {
    const c = card("Atlas AS7-D.mtf");
    const lrm = c.weapons.find((w) => w.name === "LRM 20")!;
    expect(lrm.rangeText).toBe("+4 +2 +0 +2 +4");
    const ml = c.weapons.find((w) => w.name === "Medium Laser")!;
    expect(ml.rangeText).toBe("+0 +0 +2 – –");
  });
});

describe("convertUnit: Locust LCT-1V", () => {
  const c = card("Locust LCT-1V.mtf");
  it("movement and TMM", () => {
    expect(c.move).toBe("8/12");
    expect(c.tmm).toBe(3); // run 12
  });
  it("armor", () => {
    expect(c.armor.torso).toBe(4); // (10+8+8)/6 = 4.33
    expect(c.armor.rear).toBe(1); // (2+2+2)/6 = 1
    expect(c.armor.head).toBe(4); // HD TW 8 -> bracket 8-9
    expect(c.armor.leftArm).toBe(1); // 4/3 -> 1
    expect(c.armor.leftLeg).toBe(3); // 8/3 -> 2.67 -> 3
  });
  it("structure (per-section, IS/3 min 1) and heat", () => {
    expect(c.structure.torso).toBe(2); // CT IS 6 /3
    expect(c.structure.head).toBe(1); // HD IS 3 /3
    expect(c.structure.leftArm).toBe(1); // arm IS 3 /3
    expect(c.structure.leftLeg).toBe(1); // leg IS 4 /3 -> 1.33
    expect(c.heatDissipation).toBe(2); // 10 single /5
  });
  it("weapon damage", () => {
    expect(c.weapons.map((w) => w.damage)).toEqual([2, 1, 1]); // ML, MG, MG
  });
});

describe("convertUnit: Hunchback HBK-4G", () => {
  const c = card("Hunchback HBK-4G.mtf");
  it("movement and TMM", () => {
    expect(c.move).toBe("4/6");
    expect(c.tmm).toBe(1); // run 6
  });
  it("armor / structure / heat", () => {
    expect(c.armor.torso).toBe(9); // (20+16+16)/6 = 8.67
    expect(c.armor.rear).toBe(3); // (6+6+6)/6
    expect(c.armor.head).toBe(4); // HD TW 9
    expect(c.armor.leftArm).toBe(5); // 16/3 -> 5.33
    expect(c.structure.torso).toBe(6); // 50t correction to match official builder
    expect(c.structure.leftArm).toBe(3); // arm IS 8 /3 -> 2.67
    expect(c.structure.leftLeg).toBe(4); // leg IS 12 /3
    expect(c.heatDissipation).toBe(3); // 13/5 -> 2.6
  });
  it("weapon damage (AC/20, ML, ML, Small Laser)", () => {
    expect(c.weapons.map((w) => w.damage)).toEqual([7, 2, 2, 1]);
  });
});

describe("convertUnit: Atlas AS7-D", () => {
  const c = card("Atlas AS7-D.mtf");
  it("movement and TMM (3/5 -> run 5 -> TMM 1)", () => {
    expect(c.move).toBe("3/5");
    expect(c.tmm).toBe(1);
    expect(c.tmmSprint).toBe(2);
    expect(c.tmmJump).toBe(0); // Atlas can't jump -> no jump TMM
  });
  it("armor / structure / heat", () => {
    expect(c.armor.torso).toBe(18); // (48+30+30)/6
    expect(c.armor.rear).toBe(5); // (12+9+9)/6
    expect(c.armor.head).toBe(4);
    expect(c.armor.leftArm).toBe(11); // 34/3 -> 11.33
    expect(c.armor.leftLeg).toBe(14); // 41/3 -> 13.67
    expect(c.structure.torso).toBe(10); // CT IS 31 /3 -> 10.33
    expect(c.structure.head).toBe(1); // HD IS 3 /3
    expect(c.structure.leftArm).toBe(6); // arm IS 17 /3 -> 5.67
    expect(c.structure.leftLeg).toBe(7); // leg IS 21 /3
    expect(c.heatDissipation).toBe(4); // 20/5
  });
  it("weapon damage (AC/20, LRM 20, SRM 6, 4x ML)", () => {
    expect(c.weapons.map((w) => w.damage)).toEqual([7, 7, 4, 2, 2, 2, 2]);
    expect(c.weapons.filter((w) => w.rearMounted)).toHaveLength(2);
  });
  it("has no unknown-weapon warnings", () => {
    expect(c.warnings).toEqual([]);
  });
});

describe("scaleSquadDamage (Battle Armor: each suit fires its own copy)", () => {
  const weapon = (name: string, tech: TechBase = "IS") =>
    convertWeapon({ name, location: "CT", rawLocation: "Squad", rearMounted: false }, tech, 0);

  it("scales a missile rack's base + M dice per copy, max from summed TW", () => {
    const srm2 = weapon("SRM 2"); // single profile 1+M1 (2), TW 4
    const text = (n: number) => formatDamage(scaleSquadDamage(srm2, n));
    expect([1, 2, 3, 4, 5].map(text)).toEqual([
      "1+M1 (2)",
      "2+M2 (3)",
      "3+M3 (4)",
      "4+M4 (6)",
      "5+M5 (7)",
    ]);
  });

  it("keeps direct fire flat: ceil(TW * copies / 3)", () => {
    const slas = weapon("Small Laser"); // TW 3, direct
    expect([1, 2, 3, 4, 5].map((n) => formatDamage(scaleSquadDamage(slas, n)))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    const er = weapon("ER Small Laser", "Clan"); // Clan TW 5, direct
    expect([1, 2, 3, 4, 5].map((n) => formatDamage(scaleSquadDamage(er, n)))).toEqual([
      "2",
      "4",
      "5",
      "7",
      "9",
    ]);
  });

  it("returns a flat zero profile for zero copies", () => {
    const slas = weapon("Small Laser");
    expect(scaleSquadDamage(slas, 0)).toMatchObject({ kind: "direct", base: 0, max: 0 });
  });
});

describe("Clan weapon ranges and heat-generating equipment", () => {
  const mkUnit = (over: Partial<Parameters<typeof convertUnit>[0]>) =>
    convertUnit({
      chassis: "T", model: "1", mass: 90, techBase: "Clan", config: "Biped Omnimech",
      engine: { rating: 360, type: "XL" },
      movement: { walkMP: 4, runMP: 6, jumpMP: 0, runDerived: true },
      heatSinks: { count: 14, type: "double" },
      armor: { CT: 46 }, structure: {},
      weapons: [{ name: "LRM 15", location: "LT" as never, rawLocation: "Left Torso", rearMounted: false }],
      ...over,
    });

  it("uses Clan LRM ranges (no minimum range) for a Clan unit", () => {
    const c = mkUnit({});
    const lrm = c.tics.find((t) => /lrm/i.test(t.label))!;
    // Clan LRM-15: min 0 -> PB/S +0; med 14 -> M +0; long 21 -> L +2, X +4.
    expect(lrm.rangeText).toBe("+0 +0 +0 +2 +4");
  });

  it("uses IS LRM ranges (min 6) for an IS unit", () => {
    const c = mkUnit({ techBase: "IS" });
    const lrm = c.tics.find((t) => /lrm/i.test(t.label))!;
    expect(lrm.rangeText).toBe("+4 +2 +0 +2 +4");
  });

  it("pre-pays Stealth Armor heat out of dissipation (Alpha Wolf: 28 - 10 -> 4)", () => {
    // 14 doubles = 28 dissipation; Stealth Armor burns 10 -> 18 -> round(18/5) = 4.
    const c = mkUnit({ armorType: "Stealth(Inner Sphere)" });
    expect(c.heatDissipation).toBe(4);
  });

  it("ignores stealth heat for a plain-armor unit", () => {
    const c = mkUnit({ armorType: "Standard" });
    expect(c.heatDissipation).toBe(6); // round(28/5)
  });
});

describe("AMS / Laser AMS / TAG are equipment, not weapons", () => {
  const mtf = `chassis:Test
model:EQ-1
Config:Biped
techbase:Inner Sphere
mass:55
engine:275 Fusion Engine
heat sinks:10 Single
walk mp:5
armor:Standard
CT armor:10
HD armor:9
Weapons:4
Medium Laser, Right Arm
AMS, Left Arm
Laser AMS, Right Torso
TAG, Head
`;
  const c = convertUnit(parseMtf(mtf, "EQ-1.mtf"));

  it("keeps the real weapon and drops the equipment from the weapons/TICs", () => {
    expect(c.weapons.map((w) => w.name)).toEqual(["Medium Laser"]);
    expect(c.tics.flatMap((t) => t.weapons.map((w) => w.name))).toEqual(["Medium Laser"]);
  });

  it("surfaces AMS, LAMS and TAG on the equipment line", () => {
    const labels = c.equipment.map((e) => e.label);
    expect(labels).toContain("AMS");
    expect(labels).toContain("LAMS");
    expect(labels).toContain("TAG");
  });

  it("emits no unknown-weapon warnings for them", () => {
    expect(c.warnings.join(" ")).not.toMatch(/AMS|TAG/);
  });
});

describe("MML / ATM / X-Pulse / Improved Heavy laser (DFA card batch)", () => {
  const dmg = (name: string, tech: TechBase = "IS") => {
    const c = convertWeapon({ name, location: "CT", rawLocation: "CT", rearMounted: false }, tech, 20);
    return { damageText: c.damageText, rangeText: c.rangeText, unknown: c.unknown };
  };

  it("Improved Heavy Medium Laser -> 4 (+0/+0/+2/–/–)", () => {
    expect(dmg("Improved Heavy Medium Laser", "Clan")).toEqual({
      damageText: "4", rangeText: "+0 +0 +2 – –", unknown: false,
    });
  });

  it("Medium X-Pulse Laser -> 2 (-2/-2/+0/–/–)", () => {
    expect(dmg("Medium X-Pulse Laser")).toEqual({
      damageText: "2", rangeText: "-2 -2 +0 – –", unknown: false,
    });
  });

  it("MML 3/5/7/9 match the card's range-varying missile profiles", () => {
    expect(dmg("MML 3").damageText).toBe("1|1|0+M1 (2)");
    expect(dmg("MML 5").damageText).toBe("1|1|0+M1 (3)");
    expect(dmg("MML 7").damageText).toBe("2|1|1+M1 (4)");
    expect(dmg("MML 9").damageText).toBe("2|2|1+M1 (5)");
    expect(dmg("MML 9").rangeText).toBe("+0 +0 +2 +2 +4");
  });

  it("ATM 3/6/9 match the card, and iATM shares the ATM stat block", () => {
    expect(dmg("ATM 3", "Clan").damageText).toBe("1|1|0+M1 (3)");
    expect(dmg("ATM 6", "Clan").damageText).toBe("2|1|0+M1 (5)");
    expect(dmg("ATM 9", "Clan").damageText).toBe("3|1|0+M2 (8)");
    expect(dmg("ATM 9", "Clan").rangeText).toBe("+0 +0 +2 +2 +2");
    expect(dmg("iATM 6", "Clan").damageText).toBe(dmg("ATM 6", "Clan").damageText);
  });

  it("normalizes glued MegaMek spellings (ISMML5, CLATM9, ISMediumXPulseLaser)", () => {
    expect(dmg("ISMML5").unknown).toBe(false);
    expect(dmg("ISMML5").damageText).toBe("1|1|0+M1 (3)");
    expect(dmg("CLATM9", "Clan").damageText).toBe("3|1|0+M2 (8)");
    expect(dmg("ISMediumXPulseLaser").damageText).toBe("2");
  });
});

describe("normalizer: glued ER PPC and trailing mount tags", () => {
  const conv = (name: string, tech: TechBase = "IS") =>
    convertWeapon({ name, location: "CT", rawLocation: "CT", rearMounted: false }, tech, 20);

  it("normalizes glued ISERPPC/CLERPPC (with optional count) to er ppc", () => {
    expect(normalizeWeaponName("1 ISERPPC")).toBe("er ppc");
    expect(normalizeWeaponName("CLERPPC")).toBe("er ppc");
  });

  it("keeps IS ER PPC (4) lighter than Clan (5), even on a mixed-tech unit", () => {
    // detectWeaponTech reads the weapon's own prefix and overrides the unit tech.
    expect(conv("ISERPPC", "Clan").damageText).toBe("4");
    expect(conv("CLERPPC", "IS").damageText).toBe("5");
    expect(conv("1 ISERPPC", "Clan").unknown).toBe(false);
  });

  it("strips a trailing mount/omni tag (CLERMediumLaser:OMNI -> er medium laser)", () => {
    expect(normalizeWeaponName("CLERMediumLaser:OMNI")).toBe("er medium laser");
    expect(conv("CLERMediumLaser:OMNI", "Clan").unknown).toBe(false);
    expect(conv("ISERSmallLaser:OMNI", "IS").unknown).toBe(false);
  });

  it("detectWeaponTech tolerates a leading count and uppercase prefixes", () => {
    expect(detectWeaponTech("1 ISERPPC")).toBe("IS");
    expect(detectWeaponTech("CLERMediumLaser:OMNI")).toBe("Clan");
    expect(detectWeaponTech("Medium Laser")).toBeNull();
  });
});

describe("DFA card batch 3: heavy/VSP/re-engineered lasers + ECM/C3 divert", () => {
  const dmg = (name: string, tech: TechBase = "IS") => {
    const c = convertWeapon({ name, location: "CT", rawLocation: "CT", rearMounted: false }, tech, 20);
    return { damageText: c.damageText, rangeText: c.rangeText, unknown: c.unknown };
  };

  it("Heavy Large Laser carries +1, the Improved variant removes it", () => {
    expect(dmg("Heavy Large Laser", "Clan")).toEqual({
      damageText: "6", rangeText: "+1 +1 +3 +5 –", unknown: false,
    });
    expect(dmg("Improved Heavy Large Laser", "Clan")).toEqual({
      damageText: "6", rangeText: "+0 +0 +2 +4 –", unknown: false,
    });
  });

  it("Small X-Pulse and Medium Re-engineered lasers match the card", () => {
    expect(dmg("Small X-Pulse Laser")).toEqual({ damageText: "1", rangeText: "-2 -2 +2 – –", unknown: false });
    expect(dmg("Medium Re-engineered Laser")).toEqual({ damageText: "2", rangeText: "-1 -1 +1 – –", unknown: false });
  });

  it("Medium VSP Laser uses variable damage + a literal range-bracket override", () => {
    expect(dmg("Medium VSP Laser")).toEqual({ damageText: "3|3|2", rangeText: "-3 -3 +0 – –", unknown: false });
    expect(dmg("ISMediumVSPLaser").damageText).toBe("3|3|2"); // glued spelling
  });

  it("diverts ECM / C3 / probes from the weapons block to equipment", () => {
    const mtf = `chassis:Test
model:EQ-2
Config:Biped
techbase:Inner Sphere
mass:55
engine:275 Fusion Engine
heat sinks:10 Single
walk mp:5
armor:Standard
CT armor:10
HD armor:9
Weapons:4
Medium Laser, Right Arm
ISGuardianECM, Center Torso
ISC3SlaveUnit, Center Torso
BeagleActiveProbe, Left Torso
`;
    const c = convertUnit(parseMtf(mtf, "EQ-2.mtf"));
    expect(c.weapons.map((w) => w.name)).toEqual(["Medium Laser"]);
    const labels = c.equipment.map((e) => e.label);
    expect(labels).toContain("ECM");
    expect(labels).toContain("C3 Slave"); // distinct C3 variant label
    expect(labels).toContain("Active Probe");
    expect(c.warnings.join(" ")).not.toMatch(/ECM|C3|Probe/);
  });
});

describe("construction options + C3 variants surface on the card", () => {
  const head =
    "chassis:Test\nmodel:EQ\nConfig:Biped\nTechBase:Inner Sphere\nMass:50\nEngine:200 Fusion Engine\n" +
    "Heat Sinks:10 Single\nWalk MP:4\n";
  const armorBlock = "LT Armor:8\nRT Armor:8\nCT Armor:10\nHD Armor:8\nLA Armor:6\nRA Armor:6\nLL Armor:8\nRL Armor:8\n";
  const labelsFor = (lines: string) => {
    const mtf = head + lines + "Armor:Standard\n" + armorBlock + "Weapons:0\n";
    return convertUnit(parseMtf(mtf, "EQ.mtf")).equipment.map((e) => e.label);
  };

  it("surfaces Hardened armor, Reinforced structure, and a Torso-Mounted cockpit", () => {
    const mtf =
      head + "Armor:Hardened(Inner Sphere)\nStructure:IS Reinforced\nCockpit:Torso-Mounted Cockpit\n" + armorBlock + "Weapons:0\n";
    const labels = convertUnit(parseMtf(mtf, "EQ.mtf")).equipment.map((e) => e.label);
    expect(labels).toContain("Hardened Armor");
    expect(labels).toContain("Reinforced Structure");
    expect(labels).toContain("Torso-Mounted Cockpit");
  });

  it("does not surface efficiency construction (Endo Steel / Ferro-Fibrous / Standard)", () => {
    expect(labelsFor("Structure:Clan Endo Steel\n")).not.toContain("Reinforced Structure");
    expect(labelsFor("Structure:IS Endo-Composite\n")).not.toContain("Composite Structure");
  });

  it("surfaces engine (with IS/Clan for XL/XXL) and gyro, skipping standard fusion", () => {
    const noEngHead = "chassis:Test\nmodel:EQ\nConfig:Biped\nTechBase:Inner Sphere\nMass:50\nHeat Sinks:10 Single\nWalk MP:4\n";
    const eng = (engine: string, gyro = "") => {
      const mtf = noEngHead + `Engine:${engine}\n` + (gyro ? `Gyro:${gyro}\n` : "") + "Armor:Standard\n" + armorBlock + "Weapons:0\n";
      return convertUnit(parseMtf(mtf, "E.mtf")).equipment.map((e) => e.label);
    };
    expect(eng("200 XL (Clan) Engine(IS)")).toContain("XL Engine (Clan)");
    expect(eng("200 XL Engine(IS)")).toContain("XL Engine (IS)");
    expect(eng("200 XXL Engine(IS)")).toContain("XXL Engine (IS)");
    expect(eng("200 Light Engine(IS)")).toContain("Light Engine");
    expect(eng("200 Fusion Engine(IS)")).not.toContain("XL Engine (IS)"); // standard fusion: nothing
    expect(eng("200 Fusion Engine", "Compact Gyro")).toContain("Compact Gyro");
    expect(eng("200 Fusion Engine", "Heavy Duty Gyro")).toContain("Heavy-Duty Gyro");
    expect(eng("200 Fusion Engine", "Standard Gyro")).not.toContain("XL Gyro");
  });

  it("keeps C3 variants distinct (C3i, Boosted, Master, Slave) and recognises Nova CEWS", () => {
    const crit = (name: string) =>
      convertUnit(parseMtf(head + "Armor:Standard\n" + armorBlock + `Weapons:0\nLeft Torso:\n${name}\n`, "C.mtf")).equipment.map(
        (e) => e.label,
      );
    expect(crit("ISC3iUnit")).toContain("C3i");
    expect(crit("ISImprovedC3CPU")).toContain("C3i");
    expect(crit("ISC3MasterBoostedSystemUnit")).toContain("C3 Boosted (Master)");
    expect(crit("ISC3BoostedSystemSlaveUnit")).toContain("C3 Boosted (Slave)");
    expect(crit("ISC3MasterUnit")).toContain("C3 Master");
    expect(crit("ISC3SlaveUnit")).toContain("C3 Slave");
    expect(crit("NovaCEWS")).toContain("Nova CEWS");
  });
});

describe("DFA card batch 4: ER Med Pulse, ATM-12, Plasma + heat round + aliases", () => {
  const conv = (name: string, tech: TechBase = "Clan") =>
    convertWeapon({ name, location: "CT", rawLocation: "CT", rearMounted: false }, tech, 20);
  const dmg = (name: string, tech: TechBase = "Clan") => {
    const c = conv(name, tech);
    return { damageText: c.damageText, rangeText: c.rangeText, unknown: c.unknown };
  };
  const ht = (name: string, tech: TechBase = "Clan") => ticHeat({ weapons: [conv(name, tech)] } as never);

  it("ER Medium Pulse Laser -> 3 (-1/-1/+1/+3/–)", () => {
    expect(dmg("ER Medium Pulse Laser")).toEqual({ damageText: "3", rangeText: "-1 -1 +1 +3 –", unknown: false });
  });

  it("ATM-12 -> 5|3|1+M2 (11), +0/+0/+2/+2/+2", () => {
    expect(dmg("ATM 12")).toEqual({ damageText: "5|3|1+M2 (11)", rangeText: "+0 +0 +2 +2 +2", unknown: false });
    expect(dmg("CLATM12").damageText).toBe("5|3|1+M2 (11)");
  });

  it("Plasma Cannon -> 0+H2 and Plasma Rifle -> 4+H1 (heat dice on target)", () => {
    expect(dmg("Plasma Cannon")).toEqual({ damageText: "0+H2", rangeText: "+0 +0 +2 +4 –", unknown: false });
    expect(dmg("Plasma Rifle", "IS").damageText).toBe("4+H1");
  });

  it("heat is round-nearest on the /5 scale (SRM-2 -> 0, ATM-12 -> 2)", () => {
    expect(ht("SRM 2")).toBe(0); // TW heat 2 -> round(0.4) = 0
    expect(ht("ATM 12")).toBe(2); // TW heat 8 -> round(1.6) = 2
    expect(ht("ER Medium Pulse Laser")).toBe(1); // TW heat 6 -> round(1.2) = 1
  });

  it("aliases Particle Cannon -> PPC and glued LB-X AC", () => {
    expect(normalizeWeaponName("Particle Cannon")).toBe("ppc");
    expect(normalizeWeaponName("Heavy Particle Cannon")).toBe("heavy ppc");
    expect(normalizeWeaponName("1 ISLBXAC10")).toBe("lb 10-x ac");
    expect(conv("ISLBXAC10").unknown).toBe(false);
  });
});

describe("DFA card batch 5: Thunderbolt, Extended LRM, X-Pulse/Re-eng/Heavy lasers", () => {
  const conv = (name: string, tech: TechBase = "IS") =>
    convertWeapon({ name, location: "CT", rawLocation: "CT", rearMounted: false }, tech, 20);
  const dr = (name: string, tech: TechBase = "IS") => {
    const c = conv(name, tech);
    return { damageText: c.damageText, rangeText: c.rangeText, unknown: c.unknown };
  };
  const ht = (name: string, tech: TechBase = "IS") => ticHeat({ weapons: [conv(name, tech)] } as never);

  it("Thunderbolt 5 -> 2, Ht 1 (+4/+2/+2/+4/–), direct", () => {
    expect(dr("Thunderbolt 5")).toEqual({ damageText: "2", rangeText: "+4 +2 +2 +4 –", unknown: false });
    expect(ht("Thunderbolt 5")).toBe(1);
  });

  it("Extended LRM 20 -> normal LRM-20 damage at the longer range, Ht 2", () => {
    expect(dr("Extended LRM 20")).toEqual({ damageText: "2+M2 (7)", rangeText: "+4 +2 +0 +0 +2", unknown: false });
    expect(ht("Extended LRM 20")).toBe(2);
  });

  it("Large X-Pulse / Large Re-engineered lasers -> 3 with their pulse/accuracy mods", () => {
    expect(dr("Large X-Pulse Laser")).toEqual({ damageText: "3", rangeText: "-2 -2 +0 +2 –", unknown: false });
    expect(ht("Large X-Pulse Laser")).toBe(3);
    expect(dr("Large Re-engineered Laser")).toEqual({ damageText: "3", rangeText: "-1 -1 +1 +3 –", unknown: false });
    expect(ht("Large Re-engineered Laser")).toBe(2);
  });

  it("Improved Heavy Small Laser -> 2 (+0/+0), no to-hit penalty", () => {
    expect(dr("Improved Heavy Small Laser", "Clan")).toEqual({ damageText: "2", rangeText: "+0 +0 – – –", unknown: false });
  });

  it("FIX: Heavy Medium Laser carries the +1 heavy-laser to-hit penalty", () => {
    // Was +0/+0/+2 (wrong); now +1/+1/+3 like the heavy large laser.
    expect(dr("Heavy Medium Laser", "Clan")).toEqual({ damageText: "4", rangeText: "+1 +1 +3 – –", unknown: false });
    expect(ht("Heavy Medium Laser", "Clan")).toBe(1);
  });
});

describe("DFA card batch 6: Thunderbolt family, Extended LRM, ER Large Pulse, Recoilless, MG Array", () => {
  const conv = (name: string, tech: TechBase = "IS") =>
    convertWeapon({ name, location: "CT", rawLocation: "CT", rearMounted: false }, tech, 20);
  const dr = (name: string, tech: TechBase = "IS") => {
    const c = conv(name, tech);
    return { damageText: c.damageText, rangeText: c.rangeText, unknown: c.unknown };
  };
  const ht = (name: string, tech: TechBase = "IS") => ticHeat({ weapons: [conv(name, tech)] } as never);

  it("Thunderbolt 5/10/15/20 share the T5 profile, scaling damage (2/4/5/7)", () => {
    expect(conv("Thunderbolt 5").damageText).toBe("2");
    expect(conv("Thunderbolt 10").damageText).toBe("4");
    expect(conv("Thunderbolt 15").damageText).toBe("5");
    expect(conv("Thunderbolt 20").damageText).toBe("7");
    expect(conv("Thunderbolt 20").rangeText).toBe("+4 +2 +2 +4 –");
    expect(ht("Thunderbolt 20")).toBe(2); // the others are Ht 1
  });

  it("Extended LRM = normal LRM damage at the longer range", () => {
    expect(dr("Extended LRM 5")).toEqual({ damageText: "1+M1 (2)", rangeText: "+4 +2 +0 +0 +2", unknown: false });
    expect(dr("Extended LRM 20")).toEqual({ damageText: "2+M2 (7)", rangeText: "+4 +2 +0 +0 +2", unknown: false });
    // Same damage as the plain LRM of the same size.
    expect(conv("Extended LRM 15").damageText).toBe(conv("LRM 15").damageText);
  });

  it("Clan ER Large Pulse Laser -> 4 (-1/-1/-1/+1/+3), Ht 3", () => {
    expect(dr("CLERLargePulseLaser", "Clan")).toEqual({ damageText: "4", rangeText: "-1 -1 -1 +1 +3", unknown: false });
    expect(ht("CLERLargePulseLaser", "Clan")).toBe(3);
  });

  it("Medium/Heavy Recoilless Rifle (BA) -> 1 (+0/+0/+4)", () => {
    expect(dr("ISBAMediumRecoillessRifle")).toEqual({ damageText: "1", rangeText: "+0 +0 +4 – –", unknown: false });
    expect(dr("ISBAHeavyRecoillessRifle")).toEqual({ damageText: "1", rangeText: "+0 +0 +4 – –", unknown: false });
  });

  it("MG Array is a linking device (equipment), not a weapon; plain MGs stay weapons", () => {
    expect(isWeaponBlockEquipment("Light Machine Gun Array")).toBe(true);
    expect(isWeaponBlockEquipment("Machine Gun Array")).toBe(true);
    expect(isWeaponBlockEquipment("Light Machine Gun")).toBe(false);
  });
});

describe("DFA card batch 5: Arrow IV artillery + forged TSEMP", () => {
  const conv = (name: string, tech: TechBase = "Clan") =>
    convertWeapon({ name, location: "RA", rawLocation: "RA", rearMounted: false }, tech, 50);

  it("Arrow IV -> 4+M1 (7) with no point-blank fire (–/+4/+4/+4/+4)", () => {
    const c = conv("Arrow IV");
    expect(c.damageText).toBe("4+M1 (7)");
    expect(c.rangeText).toBe("– +4 +4 +4 +4");
    expect(c.unknown).toBe(false);
  });

  it("canonicalizes Arrow IV spellings (ISArrowIVSystem, omnipod)", () => {
    expect(normalizeWeaponName("ISArrowIVSystem")).toBe("arrow iv");
    expect(conv("ISArrowIVSystem").damageText).toBe("4+M1 (7)");
    expect(conv("CLArrowIV (omnipod)").damageText).toBe("4+M1 (7)");
  });

  it("TSEMP Cannon -> SPECIAL damage, AC/10 range, 2 heat to fire", () => {
    const c = conv("TSEMP Cannon", "IS");
    expect(c.damageText).toBe("SPECIAL");
    expect(c.rangeText).toBe("+0 +0 +2 +4 –"); // like AC/10
    expect(ticHeat({ weapons: [c] } as never)).toBe(2);
    expect(c.unknown).toBe(false);
  });

  it("folds all TSEMP variants onto one profile", () => {
    expect(normalizeWeaponName("TSEMP One-Shot")).toBe("tsemp cannon");
    expect(conv("ISTSEMPCannon", "IS").damageText).toBe("SPECIAL");
  });
});
