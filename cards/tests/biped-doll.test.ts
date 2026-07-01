import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { convertAny, convertUnit, parseMtf } from "../src/core/index.js";
import { bipedDoll, fighterDoll, isBipedDoll, isQuadDoll, protoDoll, quadDoll, vehicleDoll } from "../src/web/biped-doll.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (f: string) => parseMtf(readFileSync(join(FIXTURES, f), "utf8"), f);

describe("biped/tripod silhouette doll", () => {
  const biped = convertUnit(load("Locust LCT-1V.mtf"));
  const tripod = convertUnit(load("Test Tripod TR-1.mtf"));
  const quad = convertUnit(load("Test Quad QD-1.mtf"));

  it("uses the silhouette for bipeds and tripods, the grid for quads", () => {
    expect(isBipedDoll(biped)).toBe(true);
    expect(isBipedDoll(tripod)).toBe(true);
    expect(isBipedDoll(quad)).toBe(false);
  });

  it("omits the center leg for bipeds", () => {
    const svg = bipedDoll(biped);
    expect(svg).not.toContain('class="mloc cl"');
    expect(svg).not.toContain('data-area="cl"');
    expect(svg).not.toContain("roll 1d6");
  });

  it("adds a center-leg location, dropdown, and tripod note for tripods", () => {
    const svg = bipedDoll(tripod);
    expect(svg).toContain('class="mloc cl"');
    expect(svg).toContain('data-area="cl"');
    expect(svg).toContain("C LEG");
    expect(svg).toContain("d6 3-4"); // center-leg hit sub-roll
    expect(svg).toContain("d6 1-2"); // left leg relabeled
    expect(svg).toContain("d6 5-6"); // right leg relabeled
    expect(svg).toContain("roll 1d6"); // tripod leg-location note
  });

  it("detects quads/quadvees for the four-leg doll", () => {
    expect(isQuadDoll(quad)).toBe(true);
    expect(isQuadDoll(biped)).toBe(false);
    expect(isBipedDoll(quad)).toBe(false);
  });

  it("renders four legs with front/rear labels and all area codes", () => {
    const svg = quadDoll(quad);
    for (const area of ["hd", "la", "ra", "ct", "ll", "rl", "tr"]) {
      expect(svg).toContain(`class="mloc ${area}"`);
      expect(svg).toContain(`data-area="${area}"`);
    }
    expect(svg).toContain("L FRONT");
    expect(svg).toContain("R FRONT");
    expect(svg).toContain("L REAR");
    expect(svg).toContain("R REAR");
    expect(svg).not.toContain("ARM"); // quads have no arms
    expect(svg).toContain("front legs take arm hits");
  });

  it("renders a fighter doll with the four facings + a single SI track", () => {
    const r = convertAny(readFileSync(join(FIXTURES, "Test Fighter TF-1.blk"), "utf8"), "Test Fighter TF-1.blk");
    expect(r.kind).toBe("fighter");
    const svg = r.kind === "fighter" ? fighterDoll(r.card) : "";
    for (const area of ["nose", "lw", "rw", "aft", "si"]) {
      expect(svg).toContain(`class="mloc ${area}"`);
      expect(svg).toContain(`data-area="${area}"`);
    }
    expect(svg).toContain("NOSE");
    expect(svg).toContain("L WING");
    expect(svg).toContain("R WING");
    expect(svg).toContain("AFT");
    expect(svg).toContain("SI");
  });

  it("renders a turreted vehicle doll with facings + turret + IS track", () => {
    const r = convertAny(readFileSync(join(FIXTURES, "Test Tank TT-1.blk"), "utf8"), "Test Tank TT-1.blk");
    expect(r.kind).toBe("vehicle");
    const svg = r.kind === "vehicle" ? vehicleDoll(r.card) : "";
    for (const area of ["front", "left", "right", "rear", "turret", "is"]) {
      expect(svg).toContain(`data-area="${area}"`);
    }
    expect(svg).not.toContain('data-area="rotor"');
  });

  it("renders a VTOL doll with a rotor instead of a turret", () => {
    const r = convertAny(readFileSync(join(FIXTURES, "Test Copter TV-1.blk"), "utf8"), "Test Copter TV-1.blk");
    expect(r.kind).toBe("vehicle");
    const svg = r.kind === "vehicle" ? vehicleDoll(r.card) : "";
    expect(svg).toContain('data-area="rotor"');
    expect(svg).toContain("ROTOR");
    expect(svg).not.toContain('data-area="turret"');
  });

  it("renders a protomech doll: single legs, miss markup, optional main gun", () => {
    const noGun = convertAny(readFileSync(join(FIXTURES, "Test Proto PR-1.blk"), "utf8"), "Test Proto PR-1.blk");
    expect(noGun.kind).toBe("protomech");
    const svg = noGun.kind === "protomech" ? protoDoll(noGun.card) : "";
    for (const area of ["hd", "la", "ra", "ct", "lg"]) {
      expect(svg).toContain(`data-area="${area}"`);
    }
    expect(svg).toContain('class="loc-miss"'); // 3/11 misses struck through
    expect(svg).toContain("LEGS"); // single legs location
    // Main gun only when present.
    expect(svg.includes('data-area="mg"')).toBe(noGun.kind === "protomech" && noGun.card.hasMainGun);
  });
});
