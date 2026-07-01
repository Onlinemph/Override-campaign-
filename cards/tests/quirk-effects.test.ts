import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { convertUnit, parseMtf, ticHeat } from "../src/core/index.js";
import {
  applyUnitQuirkToCard,
  applyWeaponQuirkToTic,
  quirkEffect,
  WEAPON_QUIRK_LABEL,
} from "../src/web/quirk-effects.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "tests", "fixtures");
const atlas = () => convertUnit(parseMtf(readFileSync(join(FIXTURES, "Atlas AS7-D (crits).mtf"), "utf8"), "Atlas.mtf"));

describe("quirk effects", () => {
  it("maps every weaponquirk code to a canonical name with a defined effect", () => {
    for (const [code, label] of Object.entries(WEAPON_QUIRK_LABEL)) {
      expect(quirkEffect(label), `${code} -> "${label}" has no effect`).toBeDefined();
    }
  });

  it("distinguishes the weapon 'Stabilized Weapon' from the unit 'Stable' (the Solitaire bug)", () => {
    const stabilized = quirkEffect(WEAPON_QUIRK_LABEL.stable_weapon);
    expect(WEAPON_QUIRK_LABEL.stable_weapon).toBe("Stabilized Weapon");
    expect(stabilized?.effect).toMatch(/movement/i);
    expect(stabilized?.effect).not.toEqual(quirkEffect("Stable")?.effect);
    expect(quirkEffect("Stable")?.effect).toMatch(/PSR/i);
  });

  it("resolves location/tech/level variants via suffix stripping", () => {
    expect(quirkEffect("Battle Fists (LA)")?.sign).toBe("pos");
    expect(quirkEffect("Bad Reputation (Clan)")?.sign).toBe("none");
    expect(quirkEffect("Weak Head Armor (2)")?.sign).toBe("neg");
    // Band / variant suffixes are significant and kept distinct.
    expect(quirkEffect("Improved Targeting (Long)")?.effect).toMatch(/long/i);
    expect(quirkEffect("Improved Targeting (Short)")?.effect).toMatch(/short/i);
  });

  it("covers every quirk name that actually appears in the MUL quirk index", () => {
    const idx = JSON.parse(readFileSync(join(ROOT, "public", "quirk-index.json"), "utf8")) as Record<
      string,
      { u: string[]; w: string[] }
    >;
    const names = new Set<string>();
    for (const v of Object.values(idx)) {
      for (const n of v.u ?? []) names.add(n);
      for (const n of v.w ?? []) names.add(n);
    }
    const missing = [...names].filter((n) => !quirkEffect(n));
    expect(missing, `unmapped quirks: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("applying quirk effects to 'Mech card values", () => {
  it("cooling-jacket weapon quirks set a heat override", () => {
    const tic = atlas().tics.reduce((a, b) => (ticHeat(b) > ticHeat(a) ? b : a));
    const base = ticHeat(tic);
    applyWeaponQuirkToTic(tic, "Improved Cooling Jacket");
    expect(tic.heatOverride).toBe(Math.max(1, base - 1));
    applyWeaponQuirkToTic(tic, "No Cooling Jacket"); // stacks on the override
    expect(tic.heatOverride).toBe(Math.max(1, base - 1) + 2);
  });

  it("accurate/inaccurate shift the weapon's range brackets", () => {
    const tic = atlas().tics.find((t) => t.range)!;
    const before = { ...tic.range! };
    applyWeaponQuirkToTic(tic, "Accurate Weapon");
    for (const b of ["pb", "s", "m", "l", "x"] as const) {
      if (before[b] !== null) expect(tic.range![b]).toBe((before[b] as number) - 1);
    }
  });

  it("Cowl and Weak Head Armor adjust head armor by the right amount", () => {
    const a = atlas();
    const h = a.armor.head;
    applyUnitQuirkToCard(a, "Cowl");
    expect(a.armor.head).toBe(h + 1);
    applyUnitQuirkToCard(a, "Weak Head Armor (2)");
    expect(a.armor.head).toBe(h + 1 - 2);
  });

  it("Improved Targeting (Long) only lowers the L/X brackets", () => {
    const a = atlas();
    const tic = a.tics.find((t) => t.range && t.range.l !== null)!;
    const before = { ...tic.range! };
    applyUnitQuirkToCard(a, "Improved Targeting (Long)");
    expect(tic.range!.l).toBe((before.l as number) - 1);
    if (before.s !== null) expect(tic.range!.s).toBe(before.s); // short unchanged
  });
});
