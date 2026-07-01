import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { convertUnit, parseMtf, ParseError } from "../src/core/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("parseMtf", () => {
  it("parses the Locust LCT-1V, normalizing rear-armor variants and deriving run MP + structure", () => {
    const u = parseMtf(load("Locust LCT-1V.mtf"), "Locust LCT-1V.mtf");

    expect(u.chassis).toBe("Locust");
    expect(u.model).toBe("LCT-1V");
    expect(u.mass).toBe(20);
    expect(u.techBase).toBe("IS");
    expect(u.engine).toEqual({ rating: 160, type: "Fusion", clan: false });
    expect(u.heatSinks).toEqual({ count: 10, type: "single" });

    // Run MP not in file -> ceil(8 * 1.5) = 12, flagged derived.
    expect(u.movement).toEqual({ walkMP: 8, runMP: 12, jumpMP: 0, runDerived: true });

    // RTL/RTR/RTC rear variants normalize to LTR/RTR/CTR.
    expect(u.armor.LTR).toBe(2);
    expect(u.armor.RTR).toBe(2);
    expect(u.armor.CTR).toBe(2);
    expect(u.armor.CT).toBe(10);

    // Internal structure is derived from the 20-ton table, not the file.
    expect(u.structure.CT).toBe(6);

    expect(u.weapons).toHaveLength(3);
    expect(u.weapons[0]).toMatchObject({ name: "Medium Laser", location: "CT" });
  });

  it("parses the Hunchback HBK-4G with LTR/RTR/CTR rear lines", () => {
    const u = parseMtf(load("Hunchback HBK-4G.mtf"), "Hunchback HBK-4G.mtf");
    expect(u.mass).toBe(50);
    expect(u.movement.runMP).toBe(6);
    expect(u.structure.CT).toBe(16);
    expect(u.armor.CTR).toBe(6);
    expect(u.weapons.map((w) => w.name)).toEqual([
      "AC/20",
      "Medium Laser",
      "Medium Laser",
      "Small Laser",
    ]);
  });

  it("parses the Atlas AS7-D and flags rear-mounted weapons", () => {
    const u = parseMtf(load("Atlas AS7-D.mtf"), "Atlas AS7-D.mtf");
    expect(u.mass).toBe(100);
    expect(u.movement.runMP).toBe(5); // ceil(3 * 1.5) = 5
    expect(u.structure.CT).toBe(31);
    expect(u.weapons).toHaveLength(7);
    const rear = u.weapons.filter((w) => w.rearMounted);
    expect(rear).toHaveLength(2);
    expect(rear.every((w) => w.name === "Medium Laser" && w.location === "CT")).toBe(true);
  });

  it("parses weapon lines with extra fields (ammo/facing/trailing commas) from real exports", () => {
    const mtf = `chassis:Test
model:TST-1
Config:Biped
techbase:Inner Sphere
mass:55
engine:275 Fusion Engine
heat sinks:10 Single
walk mp:5
armor:Standard
CT armor:10
LT armor:8
RT armor:8
LA armor:6
RA armor:6
LL armor:8
RL armor:8
HD armor:9
Weapons:3
Medium Laser, Left Arm, ,
SRM 6, Left Torso, 2
Medium Laser, Center Torso (R)
`;
    const u = parseMtf(mtf, "real.mtf");
    // Location is the SECOND field; trailing fields ignored; rear flag honored.
    expect(u.weapons.map((w) => [w.name, w.location, w.rearMounted])).toEqual([
      ["Medium Laser", "LA", false],
      ["SRM 6", "LT", false],
      ["Medium Laser", "CT", true],
    ]);
  });

  it("keeps weapon names with internal commas, and maps a 'None' location to CT", () => {
    const mtf =
      "chassis:T\nmodel:1\nConfig:Biped\nTechBase:Inner Sphere\nMass:65\nEngine:260 Fusion Engine\n" +
      "Heat Sinks:10 Single\nWalk MP:4\nArmor:Standard\nCT armor:10\nWeapons:2\n" +
      "Rifle (Cannon, Heavy), Left Torso\nThumper, None\n";
    const u = parseMtf(mtf, "commas.mtf");
    expect(u.weapons.map((w) => [w.name, w.location])).toEqual([
      ["Rifle (Cannon, Heavy)", "LT"], // comma inside parens does NOT split the name
      ["Thumper", "CT"], // "None" location -> CT (body/turret-mounted artillery)
    ]);
  });

  it("parses per-location crit-slot blocks (ammo, CASE, electronics), skipping -Empty-", () => {
    const u = parseMtf(load("Atlas AS7-D (crits).mtf"), "Atlas AS7-D (crits).mtf");
    const slots = u.critSlots ?? [];
    // Ammo bins land in the right locations.
    expect(slots.filter((s) => s.name === "IS Ammo AC/20" && s.location === "RT")).toHaveLength(2);
    expect(slots.filter((s) => s.name === "IS Ammo LRM-20" && s.location === "LT")).toHaveLength(2);
    expect(slots.some((s) => s.name === "ISCASE" && s.location === "LT")).toBe(true);
    expect(slots.some((s) => s.name === "ISGuardianECM" && s.location === "LT")).toBe(true);
    // -Empty- and headers are not slots.
    expect(slots.some((s) => /empty/i.test(s.name))).toBe(false);
  });

  it("accepts a blank model (Clan 'Mechs named by chassis alone)", () => {
    const mtf = `chassis:Kodiak
model:
Config:Biped
techbase:Clan
mass:100
engine:400 Fusion Engine
heat sinks:10 Double
walk mp:4
armor:Standard
CT armor:10
HD armor:9
Weapons:1
ER Large Laser, Right Arm
`;
    const u = parseMtf(mtf, "Kodiak.mtf");
    expect(u.chassis).toBe("Kodiak");
    expect(u.model).toBe("");
  });

  it("fails loudly, naming the file and field, on a missing required field", () => {
    const bad = "chassis:Foo\nmodel:Bar\nTechBase:Inner Sphere\nWalk MP:4\n";
    expect(() => parseMtf(bad, "broken.mtf")).toThrowError(ParseError);
    try {
      parseMtf(bad, "broken.mtf");
    } catch (e) {
      const err = e as ParseError;
      expect(err.file).toBe("broken.mtf");
      expect(err.field).toBe("mass");
      expect(err.message).toContain("broken.mtf");
    }
  });

  it("parses a Quad: front legs -> arms, rear legs -> legs, leg structure on all four", () => {
    const u = parseMtf(load("Test Quad QD-1.mtf"), "Test Quad QD-1.mtf");
    expect(u.config).toBe("Quad");
    // Front-leg weapons/armor map onto the arm slots, rear legs onto the legs.
    expect(u.weapons.map((w) => w.location)).toEqual(["LA", "RA", "LL"]);
    expect(u.armor.LA).toBe(24); // FLL
    expect(u.armor.RA).toBe(24); // FRL
    expect(u.armor.LL).toBe(24); // RLL
    // 80t row: arm structure 13, leg 17 — a quad's "arms" (front legs) use leg.
    expect(u.structure.LA).toBe(17);
    expect(u.structure.LL).toBe(17);
  });

  it("parses a Tripod: center leg gets its own armor, structure, and weapon mount", () => {
    const u = parseMtf(load("Test Tripod TR-1.mtf"), "Test Tripod TR-1.mtf");
    expect(u.config).toBe("Tripod");
    expect(u.armor.CL).toBe(24);
    expect(u.structure.CL).toBe(16); // 75t leg structure
    // The center-leg weapon mounts on CL (not folded into the torso).
    expect(u.weapons.find((w) => w.name === "SRM 6")?.location).toBe("CL");
  });

  it("surfaces the tripod center leg on the card; bipeds omit it", () => {
    const tri = convertUnit(parseMtf(load("Test Tripod TR-1.mtf"), "Test Tripod TR-1.mtf"));
    expect(tri.armor.centerLeg).toBe(8); // 24 / 3, round nearest
    expect(tri.structure.centerLeg).toBe(5); // 16 / 3, round nearest
    const biped = convertUnit(parseMtf(load("Locust LCT-1V.mtf"), "Locust LCT-1V.mtf"));
    expect(biped.armor.centerLeg).toBeUndefined();
    expect(biped.structure.centerLeg).toBeUndefined();
  });

  it("derives structure for ultralight (15t) and superheavy (135t) tonnages", () => {
    const ul = "chassis:U\nmodel:L\nConfig:Biped\nTechBase:Inner Sphere\nMass:15\nEngine:45 Fusion Engine\nHeat Sinks:10 Single\nWalk MP:3\nArmor:Standard\nCT Armor:5\nWeapons:0\n";
    expect(parseMtf(ul, "u.mtf").structure.CT).toBe(5);
    const sh = "chassis:S\nmodel:H\nConfig:Biped\nTechBase:Inner Sphere\nMass:135\nEngine:270 Fusion Engine\nHeat Sinks:10 Single\nWalk MP:2\nArmor:Standard\nCT Armor:10\nWeapons:0\n";
    expect(parseMtf(sh, "s.mtf").structure.CT).toBe(42);
  });
});

describe("quad melee", () => {
  it("suppresses Punch for quads (no arms) but keeps Kick", () => {
    const card = convertUnit(parseMtf(load("Test Quad QD-1.mtf"), "Test Quad QD-1.mtf"));
    expect(card.melee.punch).toBe(0);
    expect(card.melee.kick).toBeGreaterThan(0);
  });
});
