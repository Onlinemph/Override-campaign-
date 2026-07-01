import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  convertAny,
  convertProto,
  parseBlkProto,
  ParseError,
  protoFrenzyDamage,
  protoInternalStructure,
} from "../src/core/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("parseBlkProto", () => {
  const u = parseBlkProto(load("Test Proto PR-1.blk"), "Test Proto PR-1.blk");

  it("parses tonnage, movement, armor (Head/Torso/Arms/Legs), and torso weapon", () => {
    expect(u.kind).toBe("protomech");
    expect(u.tonnage).toBe(7);
    expect(u.walkMP).toBe(5);
    expect(u.jumpMP).toBe(5);
    expect(u.hasMainGun).toBe(false); // 5 armor values, no main gun
    expect(u.armor).toEqual({ head: 4, torso: 12, rightArm: 3, leftArm: 3, legs: 9, mainGun: 0 });
    expect(u.mounts).toEqual([{ name: "CLERMediumLaser", loc: "torso" }]);
  });

  it("rejects a non-ProtoMech BLK", () => {
    expect(() => parseBlkProto("<UnitType>\nTank\n</UnitType>\n<Name>\nX\n</Name>\n", "x.blk")).toThrowError(ParseError);
  });
});

describe("convertProto", () => {
  const c = convertProto(parseBlkProto(load("Test Proto PR-1.blk"), "PR-1.blk"));

  it("converts armor & structure at TW/3 (round nearest, min 1)", () => {
    // armor: 4->1, 12->4, 3->1, 9->3
    expect(c.armor).toEqual({ head: 1, torso: 4, rightArm: 1, leftArm: 1, legs: 3 });
    // structure (7t): torso 7->2, legs floor(7/2)+1=4 -> 1, head/arm 1->1
    expect(c.structure).toEqual({ head: 1, torso: 2, rightArm: 1, leftArm: 1, legs: 1 });
  });

  it("prints move walk/run/jump and TMM base/sprint/jump", () => {
    expect(c.move).toBe("5 / 8 / 5j"); // run = ceil(5*1.5)=8
    expect(c.tmmText).toBe("2 / 3 / 3"); // lookupTmm(8)=2, +1 sprint, +1 jump
  });

  it("scores the torso ER Medium Laser and a Frenzy of 2 (7t)", () => {
    const erml = c.weapons[0];
    expect(erml?.damageText).toBe("3"); // Clan ER Medium Laser
    expect(erml?.facing).toBe("T");
    expect(c.frenzy).toBe(2);
    expect(c.equipment.map((e) => e.label)).toContain("Jump Jets"); // jumpMP > 0
  });
});

describe("frenzy + structure tables", () => {
  it("frenzy by tonnage: 1 (2-5t), 2 (6-9t), 3 (10-15t)", () => {
    expect(protoFrenzyDamage(4)).toBe(1);
    expect(protoFrenzyDamage(7)).toBe(2);
    expect(protoFrenzyDamage(12)).toBe(3);
  });

  it("internal structure: torso = tonnage, legs = floor(t/2)+1", () => {
    expect(protoInternalStructure(8)).toMatchObject({ torso: 8, legs: 5, head: 1 });
    expect(protoInternalStructure(15)).toMatchObject({ torso: 15, legs: 8 });
  });
});

describe("convertAny dispatch (protomech)", () => {
  it("routes a BLK ProtoMech to the protomech path", () => {
    const r = convertAny(load("Test Proto PR-1.blk"), "PR-1.blk");
    expect(r.kind).toBe("protomech");
    if (r.kind === "protomech") expect(r.card.name).toBe("Test Proto PR-1");
  });
});
