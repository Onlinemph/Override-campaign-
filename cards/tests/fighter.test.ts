import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { convertAny, convertFighter, parseBlkFighter, ParseError } from "../src/core/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("parseBlkFighter", () => {
  const u = parseBlkFighter(load("Test Fighter TF-1.blk"), "Test Fighter TF-1.blk");

  it("parses the fighter's identity, thrust, and facing armor", () => {
    expect(u.kind).toBe("fighter");
    expect(u.chassis).toBe("Test Fighter");
    expect(u.model).toBe("TF-1");
    expect(u.techBase).toBe("IS");
    expect(u.conventional).toBe(false);
    expect(u.motionType).toBe("Aerodyne");
    expect(u.tonnage).toBe(50);
    expect(u.safeThrust).toBe(5);
    expect(u.maxThrust).toBe(8); // ceil(5 * 1.5)
    // <armor> order: nose, right wing, left wing, aft.
    expect(u.armor).toEqual({ nose: 40, rightWing: 24, leftWing: 24, aft: 16 });
  });

  it("collects mounts tagged by facing block", () => {
    expect(u.mounts).toEqual([
      { name: "Large Laser", facing: "nose" },
      { name: "Medium Laser", facing: "leftWing" },
      { name: "Medium Laser", facing: "rightWing" },
      { name: "SRM 6", facing: "aft" },
      { name: "IS Ammo SRM-6", facing: "fuselage" },
    ]);
  });

  it("flags conventional fighters from the unit type", () => {
    const conv = parseBlkFighter(
      "<UnitType>\nConvFighter\n</UnitType>\n<Name>\nX\n</Name>\n<SafeThrust>\n4\n</SafeThrust>\n",
      "x.blk",
    );
    expect(conv.conventional).toBe(true);
  });

  it("rejects a non-fighter BLK file", () => {
    expect(() =>
      parseBlkFighter("<UnitType>\nTank\n</UnitType>\n<Name>\nX\n</Name>\n", "x.blk"),
    ).toThrowError(ParseError);
  });
});

describe("convertFighter", () => {
  const c = convertFighter(parseBlkFighter(load("Test Fighter TF-1.blk"), "TF-1.blk"));

  it("mirrors thrust, single TMM, and per-facing armor (TW / 4)", () => {
    expect(c.move).toBe("5 / 8"); // safe / max
    // TMM is the single HIGHER value: max thrust 8 -> base 2 -> 3.
    expect(c.tmm).toBe(3);
    // armor = TW / 4, round nearest (nose 40 -> 10, wings 24 -> 6, aft 16 -> 4).
    expect(c.armor).toEqual({ nose: 10, rightWing: 6, leftWing: 6, aft: 4 });
    expect(c.structure).toBe(2); // 50t -> 2 (45–70t bracket)
  });

  it("computes DThr from OVERRIDE armor (nose + aft + one wing) / 30, round nearest", () => {
    // TF-1 override armor (10 + 4 + 6) / 30 = 0.67 -> 1.
    expect(c.dthr).toBe(1);
  });

  it("matches the DFA Aeshna mockup: 21 doubles -> Sinks 8, DThr 2, TMM 3", () => {
    const blk = `<UnitType>\nAero\n</UnitType>\n<Name>\nAeshna\n</Name>\n<SafeThrust>\n5\n</SafeThrust>\n<heatsinks>\n21\n</heatsinks>\n<sink_type>\n1\n</sink_type>\n<tonnage>\n100.0\n</tonnage>\n<armor>\n85\n64\n64\n54\n</armor>\n`;
    const a = convertFighter(parseBlkFighter(blk, "aeshna.blk"));
    expect(a.sinks).toBe(8); // 21 x 2 = 42 -> /5 = 8.4 -> 8
    expect(a.dthr).toBe(2); // override armor (21 + 14 + 16) / 30 = 1.7 -> 2
    expect(a.tmm).toBe(3); // max 8 -> base 2 -> higher value 3
  });

  it("zeroes sinks for conventional fighters (they do not track heat)", () => {
    const blk = `<UnitType>\nConvFighter\n</UnitType>\n<Name>\nX\n</Name>\n<SafeThrust>\n4\n</SafeThrust>\n<heatsinks>\n10\n</heatsinks>\n<sink_type>\n0\n</sink_type>\n<armor>\n20\n10\n10\n10\n</armor>\n`;
    const conv = convertFighter(parseBlkFighter(blk, "cf.blk"));
    expect(conv.sinks).toBe(0);
    expect(conv.dthr).toBe(1); // override armor (5 + 3 + 3) / 30 = 0.37 -> floored at 1
  });

  it("groups identical weapons WITHIN a facing only, tagged by facing code", () => {
    const labels = c.weapons.map((w) => `${w.facing}:${w.label}`);
    expect(labels).toContain("NO:LLas"); // Large Laser, nose
    expect(labels).toContain("AF:SRM-6");
    // The two wing medium lasers are in different facings, so they never group.
    expect(c.weapons.filter((w) => /MLas/i.test(w.label))).toHaveLength(2);
  });

  it("surfaces fuselage ammo as equipment with its facing", () => {
    const ammo = c.equipment.find((e) => /SRM/.test(e.label) && e.category === "ammo");
    expect(ammo?.facing).toBe("FS");
  });
});

describe("rear-firing wing mounts ((R) marker)", () => {
  // A left wing carrying one forward and one rear-firing ("(R)") medium laser.
  const blk = `<UnitType>\nAero\n</UnitType>\n<Name>\nTail\n</Name>\n<SafeThrust>\n5\n</SafeThrust>\n<tonnage>\n50.0\n</tonnage>\n<armor>\n40\n24\n24\n16\n</armor>\n<Left Wing Equipment>\nMedium Laser\n(R) Medium Laser\n</Left Wing Equipment>\n`;
  const u = parseBlkFighter(blk, "tail.blk");
  const c = convertFighter(u);

  it("parses a leading (R) as a rear mount and strips it from the weapon name", () => {
    expect(u.mounts).toEqual([
      { name: "Medium Laser", facing: "leftWing" },
      { name: "Medium Laser", facing: "leftWing", rear: true },
    ]);
  });

  it("marks the rear weapon's facing with (R), in its own TIC, still resolved", () => {
    const lw = c.weapons.filter((w) => /MLas/i.test(w.label));
    expect(lw.map((w) => w.facing).sort()).toEqual(["LW", "LW (R)"]);
    expect(lw.every((w) => !w.unknown)).toBe(true); // (R) stripped → known weapon
  });
});

describe("convertAny dispatch (fighter)", () => {
  it("routes a BLK Aero to the fighter path", () => {
    const r = convertAny(load("Test Fighter TF-1.blk"), "TF-1.blk");
    expect(r.kind).toBe("fighter");
    if (r.kind === "fighter") expect(r.card.name).toBe("Test Fighter TF-1");
  });
});
