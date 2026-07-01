import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { convertAny, convertDropship, parseBlkDropship, ParseError } from "../src/core/index.js";
import { renderDropshipCard } from "../src/web/dropship-card.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("parseBlkDropship", () => {
  const u = parseBlkDropship(load("Test Dropship DS-1.blk"), "Test Dropship DS-1.blk");

  it("parses identity, thrust, sinks, SI, and arc armor", () => {
    expect(u.kind).toBe("dropship");
    expect(u.chassis).toBe("Test Dropship");
    expect(u.tonnage).toBe(3000);
    expect(u.safeThrust).toBe(4);
    expect(u.maxThrust).toBe(6); // ceil(4 * 1.5)
    expect(u.heatSinkCount).toBe(40);
    expect(u.heatSinkType).toBe("double");
    expect(u.structuralIntegrity).toBe(12);
    // <armor> order: nose, left side, right side, aft.
    expect(u.armor).toEqual({ nose: 300, leftSide: 250, rightSide: 250, aft: 200 });
  });

  it("collects mounts per arc, stripping the '(B)' bay marker", () => {
    expect(u.mounts.filter((m) => m.facing === "nose").map((m) => m.name)).toEqual(["LRM 20", "LRM 20"]);
    expect(u.mounts.filter((m) => m.facing === "hull")).toHaveLength(2); // ammo
  });

  it("parses transport bays, skipping crew quarters", () => {
    expect(u.bays).toEqual([
      { label: "'Mech", size: 4 },
      { label: "Fighter", size: 2 },
      { label: "Cargo", size: 1800, tons: true },
    ]);
  });

  it("rejects a non-Dropship BLK", () => {
    expect(() => parseBlkDropship("<UnitType>\nTank\n</UnitType>\n<Name>\nX\n</Name>\n", "x.blk")).toThrowError(
      ParseError,
    );
  });
});

describe("convertDropship (aerospace rules)", () => {
  const c = convertDropship(parseBlkDropship(load("Test Dropship DS-1.blk"), "DS-1.blk"));

  it("converts armor at TW/4, SI at TW/3, sinks at dissipation/5", () => {
    expect(c.armor).toEqual({ nose: 75, leftSide: 63, rightSide: 63, aft: 50 }); // /4 round nearest
    expect(c.structure).toBe(4); // SI 12 / 3
    expect(c.sinks).toBe(16); // 40 doubles -> 80 -> /5
  });

  it("computes DThr from OVERRIDE armor (nose + aft + one side)/30 and single TMM", () => {
    expect(c.dthr).toBe(6); // override armor (75 + 50 + 63) / 30 = 6.27 -> 6
    expect(c.tmm).toBe(2); // max 6 -> base 1 -> higher value 2
    expect(c.move).toBe("4 / 6");
  });

  it("groups nose LRM-20s into one TIC and routes hull ammo to equipment", () => {
    const nose = c.weapons.filter((w) => w.facing === "NO");
    expect(nose).toHaveLength(1);
    expect(nose[0]!.label).toMatch(/x2.*LRM/i);
    const ammo = c.equipment.find((e) => e.category === "ammo");
    expect(ammo?.facing).toBe("HL");
    expect(ammo?.count).toBe(2);
  });
});

describe("weapon bays (the '(B)' groups)", () => {
  // Nose holds two bays: 5 ER PPC, then 2 Large Lasers.
  const blk =
    `<UnitType>\nDropship\n</UnitType>\n<Name>\nBay\n</Name>\n<motion_type>\nSpheroid\n</motion_type>\n` +
    `<SafeThrust>\n3\n</SafeThrust>\n<heatsinks>\n20\n</heatsinks>\n<sink_type>\n1\n</sink_type>\n` +
    `<structural_integrity>\n10\n</structural_integrity>\n<armor>\n100\n80\n80\n60\n</armor>\n` +
    `<Nose Equipment>\n(B) ISERPPC\nISERPPC\nISERPPC\nISERPPC\nISERPPC\n(B) Large Laser\nLarge Laser\n</Nose Equipment>\n` +
    `<tonnage>\n2000.0\n</tonnage>\n`;

  it("assigns a bay id per '(B)' group, resetting per arc", () => {
    const u = parseBlkDropship(blk, "bay.blk");
    const nose = u.mounts.filter((m) => m.facing === "nose");
    expect(nose.map((m) => m.bay)).toEqual([1, 1, 1, 1, 1, 2, 2]); // 5 in bay 1, 2 in bay 2
  });

  it("fires each bay as ONE TIC, summed with no 'Mech caps", () => {
    const c = convertDropship(parseBlkDropship(blk, "bay.blk"));
    const nose = c.weapons.filter((w) => w.facing === "NO");
    expect(nose).toHaveLength(2); // two bays -> two rows
    expect(nose[0]!.label).toMatch(/x5 ER PPC/i);
    expect(nose[0]!.damageText).toBe("17"); // 5 x TW 10 = 50 -> ceil/3 (over the 14 TIC cap)
    expect(nose[1]!.label).toMatch(/x2 .*LLas/i);
    expect(nose[1]!.damageText).toBe("6"); // 2 x TW 8 = 16 -> ceil/3
  });
});

describe("spheroid rear sub-arc ((R) split)", () => {
  // A side arc with a forward and a rear-firing ("(R)") bay — the spheroid aft sub-arc.
  const blk =
    `<UnitType>\nDropship\n</UnitType>\n<Name>\nSplit\n</Name>\n<motion_type>\nSpheroid\n</motion_type>\n` +
    `<SafeThrust>\n3\n</SafeThrust>\n<heatsinks>\n20\n</heatsinks>\n<sink_type>\n1\n</sink_type>\n` +
    `<structural_integrity>\n10\n</structural_integrity>\n<armor>\n100\n80\n80\n60\n</armor>\n` +
    `<Left Side Equipment>\n(B) Large Laser\n(R) (B) Large Laser\n</Left Side Equipment>\n` +
    `<tonnage>\n2000.0\n</tonnage>\n`;

  it("flags the (R) bay as rear and strips the marker from the name", () => {
    const ls = parseBlkDropship(blk, "split.blk").mounts.filter((m) => m.facing === "leftSide");
    expect(ls).toEqual([
      { name: "Large Laser", facing: "leftSide", bay: 1 },
      { name: "Large Laser", facing: "leftSide", rear: true, bay: 2 },
    ]);
  });

  it("splits the side into LS and LS (R) arcs on the card", () => {
    const c = convertDropship(parseBlkDropship(blk, "split.blk"));
    expect(c.weapons.map((w) => w.facing).sort()).toEqual(["LS", "LS (R)"]);
  });
});

describe("card layout", () => {
  it("groups the weapon table into per-arc sections (no Loc column)", () => {
    const html = renderDropshipCard(convertDropship(parseBlkDropship(load("Test Dropship DS-1.blk"), "DS-1.blk")));
    expect(html).toContain('class="arc-head"');
    expect(html).toContain(">Nose<");
    expect(html).toContain(">Left Side<");
    expect(html).toContain(">Right Side<");
    expect(html).not.toContain(">Loc<"); // the per-row Loc column is replaced by the section headers
  });
});


describe("WarShip (extends the DropShip path)", () => {
  const blk =
    `<UnitType>\nWarship\n</UnitType>\n<Name>\nTest WarShip\n</Name>\n<motion_type>\nAerodyne\n</motion_type>\n` +
    `<SafeThrust>\n3\n</SafeThrust>\n<heatsinks>\n100\n</heatsinks>\n<sink_type>\n1\n</sink_type>\n` +
    `<structural_integrity>\n60\n</structural_integrity>\n<armor>\n37\n37\n37\n35\n37\n37\n</armor>\n` +
    `<Nose Equipment>\n(B) Naval Autocannon (NAC/20)\nNaval Autocannon (NAC/20)\n</Nose Equipment>\n` +
    `<Left Broadsides Equipment>\n(B) Large Laser\nLarge Laser\n</Left Broadsides Equipment>\n` +
    `<tonnage>\n620000.0\n</tonnage>\n`;

  it("parses the Warship type, 6-facing armor (aft = index 3), and broadside arcs", () => {
    const u = parseBlkDropship(blk, "ws.blk");
    expect(u.shipClass).toBe("WarShip");
    // <armor> 37 37 37 35 37 37 -> aft is the index-3 value (35), the four corners 37.
    expect(u.armor).toEqual({
      nose: 37,
      leftSide: 37,
      rightSide: 37,
      aft: 35,
      foreLeft: 37,
      foreRight: 37,
      aftLeft: 37,
      aftRight: 37,
    });
    expect(u.mounts.map((m) => m.facing)).toEqual(["nose", "nose", "leftBroad", "leftBroad"]);
  });

  it("converts to a WarShip card: capital armor ÷ 3, naval bays carry capital damage", () => {
    const c = convertDropship(parseBlkDropship(blk, "ws.blk"));
    expect(c.shipClass).toBe("WarShip");
    expect(c.armor.nose).toBe(12); // 37 capital / 3 -> 12
    expect(c.armor.aft).toBe(12); // 35 / 3 -> 12
    expect(c.armor.aftLeft).toBe(12);
    const nose = c.weapons.find((w) => w.facing === "NO");
    expect(nose?.unknown).toBe(false); // NAC/20 now has capital-scale stats
    expect(nose?.damageText).toBe("14"); // 2x NAC/20 = 40 capital -> ceil(40/3)
    // Standard weapons do 1/10 vs capital armor: 2x Large Laser = 16 TW / 10 -> ceil(1.6/3).
    const broad = c.weapons.find((w) => w.facing === "LB");
    expect(broad?.damageText).toBe("1");
    expect(c.warnings).toHaveLength(0);
  });

  it("renders WarShip arc sections, the six hex-side armor boxes, and the type label", () => {
    const html = renderDropshipCard(convertDropship(parseBlkDropship(blk, "ws.blk")));
    expect(html).toContain(">Left Broadside<"); // weapon-table arc section
    expect(html).toContain("WarShip");
    expect(html).toContain('class="ddoll warship"');
    for (const side of ["Nose", "Fore-Left", "Fore-Right", "Aft-Left", "Aft-Right", "Aft"]) {
      expect(html).toContain(`>${side}<`);
    }
  });
});

describe("convertAny dispatch (dropship)", () => {
  it("routes a BLK Dropship to the dropship path", () => {
    const r = convertAny(load("Test Dropship DS-1.blk"), "DS-1.blk");
    expect(r.kind).toBe("dropship");
    if (r.kind === "dropship") expect(r.card.name).toBe("Test Dropship DS-1");
  });
});
