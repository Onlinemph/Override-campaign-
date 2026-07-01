import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  convertAny,
  convertBattleArmor,
  detectFormat,
  isBlk,
  parseBlkBattleArmor,
  ParseError,
} from "../src/core/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("BLK format detection", () => {
  it("recognizes BLK by its tags and leaves MTF alone", () => {
    expect(isBlk(load("Elemental Laser.blk"))).toBe(true);
    expect(detectFormat(load("Elemental Laser.blk"))).toBe("blk");
    expect(isBlk(load("Locust LCT-1V.mtf"))).toBe(false);
    expect(detectFormat(load("Locust LCT-1V.mtf"))).toBe("mtf");
  });
});

describe("parseBlkBattleArmor", () => {
  it("parses the Elemental [Laser] squad: names, movement, squad mounts", () => {
    const u = parseBlkBattleArmor(load("Elemental Laser.blk"), "Elemental Laser.blk");

    expect(u.kind).toBe("battlearmor");
    expect(u.chassis).toBe("Elemental");
    expect(u.model).toBe("[Laser]");
    expect(u.techBase).toBe("Clan");
    expect(u.troopers).toBe(5);
    expect(u.weightClass).toBe("Heavy"); // <weightclass> index 3
    expect(u.walkMP).toBe(1);
    expect(u.jumpMP).toBe(3);
    expect(u.motionType).toBe("Jump");
    expect(u.armorPerTrooper).toBe(10);
    expect(u.chassisType).toBe("biped");

    // Squad-wide mounts are carried by every trooper -> copies = trooper count.
    expect(u.mounts).toEqual([
      { name: "CLERSmallLaser", mount: "RA", copies: 5 },
      { name: "CLSRM2 (OS)", mount: "LA", copies: 5 },
      { name: "CLSRM2 (OS) Ammo", mount: "Body", copies: 5 },
      { name: "Battle Claw", mount: "LA", copies: 5 },
    ]);
  });

  it("rejects non-BattleArmor BLK files with a clear error", () => {
    const tank = "<UnitType>\nTank\n</UnitType>\n<Name>\nManticore\n</Name>\n";
    expect(() => parseBlkBattleArmor(tank, "tank.blk")).toThrowError(ParseError);
    try {
      parseBlkBattleArmor(tank, "tank.blk");
    } catch (e) {
      expect((e as ParseError).message).toContain("unsupported BLK unit type");
    }
  });
});

describe("convertBattleArmor", () => {
  const card = convertBattleArmor(parseBlkBattleArmor(load("Elemental Laser.blk"), "Elemental.blk"));

  it("produces a tagged BA card with mirrored armor/TMM and squad firepower", () => {
    expect(card.kind).toBe("battlearmor");
    expect(card.name).toBe("Elemental [Laser]");
    expect(card.techBase).toBe("Clan");
    expect(card.troopers).toBe(5);
    expect(card.weightClass).toBe("Heavy");
    expect(card.move).toBe("1/3 (J)");

    // Armor mirrors arm/leg: round(10 / 3) = 3 (min 1).
    expect(card.armorPerTrooper).toBe(10);
    expect(card.armor).toBe(3);

    // TMM mirrors run-MP table on the fastest mode (jump 3 -> 0); +2 jump.
    expect(card.tmm).toBe(0);
    expect(card.tmmJump).toBe(2);

    expect(card.antiMech).toBe(true); // Heavy class can anti-'Mech
  });

  it("replicates per-trooper weapons across the squad and groups them into TICs", () => {
    // 5 ER Small Lasers + 5 SRM 2 = 10 weapons; Battle Claw + ammo are not weapons.
    expect(card.weapons).toHaveLength(10);

    // SRM 2 x5 fits one TIC; the profile scales per weapon (base 1*5, M 1*5,
    // max ceil(20/3)), matching the firepower table's full-squad column.
    const srm = card.tics.find((t) => /srm/i.test(t.label));
    expect(srm?.count).toBe(5);
    expect(srm?.damageText).toBe("5+M5 (7)");

    // ER Small Lasers split across the page-41 cap into two TICs (3 + 2).
    const laserTics = card.tics.filter((t) => /laser/i.test(t.label));
    expect(laserTics.map((t) => t.count).sort()).toEqual([2, 3]);
  });

  it("includes anti-infantry damage (1d6 per surviving suit)", () => {
    // Five troopers: byTrooper[0] = 1 suit = "1d6", byTrooper[4] = full squad = "5d6".
    expect(card.antiInfantryByTrooper).toEqual(["1d6", "2d6", "3d6", "4d6", "5d6"]);
  });

  it("builds a per-trooper firepower table (damage summed by surviving suits, not TICs)", () => {
    // One row per distinct weapon; byTrooper[i] is (i+1) suits firing.
    expect(card.firepower).toHaveLength(2);

    const srm = card.firepower.find((w) => /srm/i.test(w.label))!;
    expect(srm.label).toBe("cSRM-2"); // abbreviated, Clan prefix
    expect(srm.perTrooper).toBe(1);
    // Each trooper fires its own SRM 2, so base + M dice scale per suit while the
    // max stays ceil(totalTW / 3). Matches the printed Override BA card.
    expect(srm.byTrooper).toEqual([
      "1+M1 (2)", // 1 suit
      "2+M2 (3)", // 2 suits
      "3+M3 (4)", // 3 suits
      "4+M4 (6)", // 4 suits
      "5+M5 (7)", // full squad
    ]);

    // ER Small Laser is direct fire: flat ceil(5 * n / 3) per surviving count.
    const laser = card.firepower.find((w) => /las/i.test(w.label))!;
    expect(laser.label).toBe("ER SLas"); // abbreviated
    expect(laser.perTrooper).toBe(1);
    expect(laser.byTrooper).toEqual(["2", "4", "5", "7", "9"]);
  });

  it("surfaces ammo as equipment, counted per squad copy", () => {
    expect(card.equipment).toHaveLength(1);
    expect(card.equipment[0]).toMatchObject({ category: "ammo", count: 5 });
    // Manipulators (Battle Claw) are neither weapons nor surfaced gear.
    expect(card.weapons.some((w) => /claw/i.test(w.name))).toBe(false);
  });
});

describe("convertAny dispatch", () => {
  it("routes BLK to the BA path and MTF to the 'Mech path", () => {
    const ba = convertAny(load("Elemental Laser.blk"), "Elemental.blk");
    expect(ba.kind).toBe("battlearmor");

    const mech = convertAny(load("Locust LCT-1V.mtf"), "Locust.mtf");
    expect(mech.kind).toBe("mech");
    expect(mech.card.name).toBe("Locust LCT-1V");
  });
});

describe("Battle Armor: anti-personnel weapons are ignored", () => {
  const blk = `<UnitType>
BattleArmor
</UnitType>
<Name>
Test BA
</Name>
<type>
Clan Level 2
</type>
<motion_type>
Jump
</motion_type>
<Trooper Count>
5
</Trooper Count>
<weightclass>
3
</weightclass>
<armor>
10
</armor>
<Squad Equipment>
CLERSmallLaser:RA
InfantryAssaultRifle:APM
Infantry Auto Rifle:LA
Laser Rifle (Mauser 960):APM
</Squad Equipment>
`;
  const c = convertBattleArmor(parseBlkBattleArmor(blk, "test.blk"));

  it("keeps the real weapon and drops the anti-personnel small arms", () => {
    const labels = c.firepower.map((f) => f.label);
    expect(labels.some((l) => /ER Small Laser|SLas/i.test(l))).toBe(true);
    expect(labels.some((l) => /infantry|rifle|mauser/i.test(l))).toBe(false);
  });

  it("emits no unknown-weapon warning for the anti-personnel weapons", () => {
    expect(c.warnings.join(" ")).not.toMatch(/[Ii]nfantry|[Mm]auser|[Rr]ifle/);
  });
});
