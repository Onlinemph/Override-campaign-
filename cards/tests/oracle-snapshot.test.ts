/**
 * Oracle lock-in (snapshot regression).
 *
 * Pins the converted output so a future change can't SILENTLY alter a value that
 * was hand-verified against the DFA Override Card Generator (the oracle). Two
 * layers:
 *   1. Full-unit conversions for every fixture (one per unit family) — catches
 *      integration regressions (armor/structure formulas, TIC grouping, etc.).
 *   2. Every weapon's converted profile (damage / heat / range) in both tech
 *      bases — pins the bulk of the "VERIFIED vs DFA" weapon-table work.
 *
 * Snapshots track converted DATA, not rendered HTML, so card layout / CSS churn
 * doesn't create noise. If a change is intentional, run `vitest -u` to refresh
 * the snapshots and review the diff.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { convertAny, convertWeapon, lookupWeaponHeat, roundNearest, WEAPON_DAMAGE } from "../src/core/index.js";
import type { Weapon } from "../src/core/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("oracle lock-in: full-unit conversions", () => {
  const files = readdirSync(FIXTURES)
    .filter((f) => /\.(mtf|blk)$/i.test(f))
    .sort();
  for (const file of files) {
    it(`converts ${file} to its locked card`, () => {
      expect(convertAny(readFileSync(join(FIXTURES, file), "utf8"), file)).toMatchSnapshot();
    });
  }
});

describe("oracle lock-in: weapon profiles", () => {
  const summary = (name: string, tech: "IS" | "Clan"): string => {
    const w: Weapon = { name, location: "CT", rearMounted: false };
    const cw = convertWeapon(w, tech, 0);
    const heat = roundNearest(lookupWeaponHeat(name) / 5);
    return `dmg ${cw.damageText} | Ht ${heat} | rng ${cw.rangeText ?? "—"}`;
  };
  for (const tech of ["IS", "Clan"] as const) {
    it(`${tech} weapon profiles`, () => {
      const out: Record<string, string> = {};
      for (const name of Object.keys(WEAPON_DAMAGE).sort()) out[name] = summary(name, tech);
      expect(out).toMatchSnapshot();
    });
  }
});
