import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { convertAny, convertVehicle, parseBlkVehicle, ParseError } from "../src/core/index.js";
import { renderVehicleCard } from "../src/web/vehicle-card.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("parseBlkVehicle", () => {
  const u = parseBlkVehicle(load("Test Tank TT-1.blk"), "Test Tank TT-1.blk");

  it("parses the tank's identity, movement, and facing armor", () => {
    expect(u.kind).toBe("vehicle");
    expect(u.chassis).toBe("Test Tank");
    expect(u.model).toBe("TT-1");
    expect(u.techBase).toBe("IS");
    expect(u.motionType).toBe("Tracked");
    expect(u.tonnage).toBe(60);
    expect(u.cruiseMP).toBe(4);
    expect(u.flankMP).toBe(6); // ceil(4 * 1.5)
    expect(u.hasTurret).toBe(true);
    // <armor> order: front, right, left, rear, turret.
    expect(u.armor).toEqual({ front: 40, right: 30, left: 30, rear: 20, turret: 35 });
  });

  it("collects mounts tagged by facing block", () => {
    expect(u.mounts).toEqual([
      { name: "LRM 10", facing: "front" },
      { name: "Machine Gun", facing: "right" },
      { name: "Machine Gun", facing: "left" },
      { name: "PPC", facing: "turret" },
      { name: "SRM 6", facing: "turret" },
      { name: "SRM 6", facing: "turret" },
      { name: "IS Ammo SRM 6", facing: "turret" },
    ]);
  });

  it("rejects a non-vehicle BLK file", () => {
    expect(() =>
      parseBlkVehicle("<UnitType>\nInfantry\n</UnitType>\n<Name>\nX\n</Name>\n", "x.blk"),
    ).toThrowError(ParseError);
  });
});

describe("parseBlkVehicle (VTOL)", () => {
  const u = parseBlkVehicle(load("Test Copter TV-1.blk"), "Test Copter TV-1.blk");

  it("parses the rotor as the 5th armor value and flags hasRotor", () => {
    expect(u.motionType).toBe("VTOL");
    expect(u.hasRotor).toBe(true);
    expect(u.hasTurret).toBe(false);
    expect(u.tonnage).toBe(20);
    expect(u.cruiseMP).toBe(8);
    expect(u.flankMP).toBe(12); // ceil(8 * 1.5)
    // <armor>: front, right, left, rear, rotor.
    expect(u.armor).toEqual({ front: 12, right: 8, left: 8, rear: 4, rotor: 2 });
  });

  it("collects rotor/facing mounts", () => {
    expect(u.mounts).toEqual([
      { name: "LRM 5", facing: "front" },
      { name: "Machine Gun", facing: "right" },
      { name: "Machine Gun", facing: "left" },
    ]);
  });
});

describe("convertVehicle (VTOL)", () => {
  const c = convertVehicle(parseBlkVehicle(load("Test Copter TV-1.blk"), "TV-1.blk"));

  it("shows the flying move letter and a rotor armor location", () => {
    expect(c.move).toBe("8 / 12v"); // VTOL motion letter
    expect(c.hasRotor).toBe(true);
    // armor = TW / 4, round nearest (rotor 2 -> 1, min 1).
    expect(c.armor).toEqual({ front: 3, right: 2, left: 2, rear: 1, rotor: 1 });
    expect(c.structure).toBe(1); // 20t -> 1 (≤40t bracket)
  });

  it("tags rotor weapons with the RO facing code", () => {
    const front = c.weapons.find((w) => /LRM/.test(w.label));
    expect(front?.facing).toBe("FR");
  });
});

describe("convertAny dispatch (VTOL)", () => {
  it("routes a BLK VTOL to the vehicle path", () => {
    const r = convertAny(load("Test Copter TV-1.blk"), "TV-1.blk");
    expect(r.kind).toBe("vehicle");
    if (r.kind === "vehicle") expect(r.card.hasRotor).toBe(true);
  });
});

describe("convertVehicle MASC / Supercharger boost", () => {
  const base = parseBlkVehicle(load("Test Tank TT-1.blk"), "TT-1.blk"); // cruise 4
  const withEquip = (...names: string[]) =>
    convertVehicle({ ...base, mounts: [...base.mounts, ...names.map((name) => ({ name, facing: "body" as const }))] });

  it("scales cruise ×1.25 with a Supercharger (4 -> 5/8)", () => {
    expect(withEquip("ISSuperCharger").move).toBe("5 / 8t"); // ceil(4*1.25)=5, ceil(5*1.5)=8
  });

  it("scales cruise ×1.5 with both MASC and a Supercharger (4 -> 6/9)", () => {
    expect(withEquip("Supercharger", "MASC").move).toBe("6 / 9t"); // ceil(4*1.5)=6, ceil(6*1.5)=9
  });

  it("leaves movement unchanged without either device", () => {
    expect(convertVehicle(base).move).toBe("4 / 6t");
  });
});

describe("convertVehicle", () => {
  const c = convertVehicle(parseBlkVehicle(load("Test Tank TT-1.blk"), "TT-1.blk"));

  it("mirrors movement (with motion letter), TMM, and per-facing armor", () => {
    expect(c.move).toBe("4 / 6t"); // tracked
    expect(c.tmm).toBe(1); // flank 6 -> base TMM 1 (card prints 1 / 2)
    // armor = TW / 4, round nearest (front 40 -> 10, rear 20 -> 5, turret 35 -> 9).
    expect(c.armor).toEqual({ front: 10, right: 8, left: 8, rear: 5, turret: 9 });
    expect(c.structure).toBe(2); // 60t -> 2 (45–70t bracket)
  });

  it("groups identical weapons WITHIN a facing only, tagged by facing code", () => {
    const labels = c.weapons.map((w) => `${w.facing}:${w.label}`);
    // Front LRM, two side MGs (separate facings), turret PPC + grouped 2x SRM-6.
    expect(labels).toContain("FR:LRM-10");
    expect(labels).toContain("TU:PPC");
    expect(labels).toContain("TU:x2 SRM-6");
    // The two side machine guns are in different facings, so they never group.
    expect(c.weapons.filter((w) => /Machine Gun|MG/i.test(w.label))).toHaveLength(2);

    const srm = c.weapons.find((w) => /SRM/.test(w.label))!;
    expect(srm.damageText).toBe("2+M4 (8)"); // 2x SRM-6 scaled
    expect(srm.heat).toBe(2); // round(8 / 5)
  });

  it("surfaces turret ammo as equipment with its facing", () => {
    const ammo = c.equipment.find((e) => /SRM/.test(e.label) && e.category === "ammo");
    expect(ammo?.facing).toBe("TU");
  });
});

describe("convertAny dispatch", () => {
  it("routes a BLK Tank to the vehicle path", () => {
    const r = convertAny(load("Test Tank TT-1.blk"), "TT-1.blk");
    expect(r.kind).toBe("vehicle");
    expect(r.card.name).toBe("Test Tank TT-1");
  });
});

describe("hit-location diagram (turret rolls reallocate when turretless)", () => {
  const tank = (armorLines: string) =>
    convertVehicle(
      parseBlkVehicle(
        `<UnitType>\nTank\n</UnitType>\n<Name>\nHL\n</Name>\n<motion_type>\nTracked\n</motion_type>\n` +
          `<cruiseMP>\n4\n</cruiseMP>\n<armor>\n${armorLines}\n</armor>\n` +
          `<Front Equipment>\nMedium Laser\n</Front Equipment>\n<tonnage>\n20.0\n</tonnage>\n`,
        "hl.blk",
      ),
    );

  it("a turreted vehicle keeps 5 & 9 on the turret", () => {
    const c = tank("20\n15\n15\n10\n12"); // 5 values -> turret
    expect(c.hasTurret).toBe(true);
    const html = renderVehicleCard(c);
    expect(html).toContain('data-area="turret"');
    expect(html).toContain('<span class="dmg-name">TURRET</span><span class="dmg-hits">5,9</span>');
    expect(html).toContain('<span class="dmg-name">R SIDE</span><span class="dmg-hits">3,4</span>');
    expect(html).toContain('<span class="dmg-name">L SIDE</span><span class="dmg-hits">10,11</span>');
  });

  it("a turretless vehicle reallocates 5 -> Right and 9 -> Left", () => {
    const c = tank("20\n15\n15\n10"); // 4 values -> no turret
    expect(c.hasTurret).toBe(false);
    const html = renderVehicleCard(c);
    expect(html).not.toContain('data-area="turret"'); // no turret slot at all
    expect(html).toContain('<span class="dmg-name">R SIDE</span><span class="dmg-hits">3,4,5</span>');
    expect(html).toContain('<span class="dmg-name">L SIDE</span><span class="dmg-hits">9,10,11</span>');
  });
});

describe("Support vehicles (SupportTank / LargeSupportTank / SupportVTOL)", () => {
  const blk = (type: string, motion: string, rotor = "") =>
    `<UnitType>\n${type}\n</UnitType>\n<Name>\nSup\n</Name>\n<motion_type>\n${motion}\n</motion_type>\n` +
    `<cruiseMP>\n4\n</cruiseMP>\n<armor>\n20\n16\n16\n12${rotor}\n</armor>\n` +
    `<Front Equipment>\nMedium Laser\n</Front Equipment>\n<tonnage>\n50.0\n</tonnage>\n`;

  it("routes a SupportTank through the vehicle path and flags it support", () => {
    const u = parseBlkVehicle(blk("SupportTank", "Wheeled"), "s.blk");
    expect(u.kind).toBe("vehicle");
    expect(u.support).toBe(true);
    expect(u.hasRotor).toBe(false);
    const c = convertVehicle(u);
    expect(c.support).toBe(true);
    expect(c.armor.front).toBe(5); // 20 / 4
  });

  it("treats a SupportVTOL as a rotored support vehicle", () => {
    const r = convertAny(blk("SupportVTOL", "VTOL", "\n8"), "v.blk");
    expect(r.kind).toBe("vehicle");
    if (r.kind === "vehicle") {
      expect(r.card.support).toBe(true);
      expect(r.card.hasRotor).toBe(true);
      expect(r.card.armor.rotor).toBe(2); // 8 / 4
    }
  });

  it("LargeSupportTank is accepted too", () => {
    expect(parseBlkVehicle(blk("LargeSupportTank", "Tracked"), "l.blk").support).toBe(true);
  });

  it("routes a Naval (Hydrofoil) unit through the vehicle path", () => {
    const r = convertAny(blk("Naval", "Hydrofoil"), "n.blk");
    expect(r.kind).toBe("vehicle");
    if (r.kind === "vehicle") expect(r.card.move).toMatch(/f$/); // Hydrofoil motion letter
  });
});
