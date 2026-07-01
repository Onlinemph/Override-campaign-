import { describe, expect, it } from "vitest";

import {
  convertFighter,
  convertUnit,
  convertWeapon,
  groupingLocation,
  isLegalTic,
  parseBlkFighter,
  parseMtf,
} from "../src/core/index.js";
import type { CardWeapon } from "../src/core/index.js";
import {
  applyMove,
  groupingFromTics,
  renderTicEditorHtml,
  ticsFromGrouping,
} from "../src/web/tic-editor.js";
import type { EditorFacets } from "../src/web/tic-editor.js";

const mechFacets: EditorFacets = {
  keyOf: (w: CardWeapon) => groupingLocation(w.location) + (w.rearMounted ? "|R" : ""),
  facetLabel: (w: CardWeapon) => w.location,
  enforceCaps: true,
};
const facingFacets: EditorFacets = {
  keyOf: (w: CardWeapon) => w.rawLocation ?? "",
  facetLabel: (w: CardWeapon) => w.rawLocation ?? "—",
  enforceCaps: true,
};

// Two Medium Lasers in the torso (auto-group into one TIC) + one in an arm.
const MECH = `chassis:Test
model:TIC-1
Config:Biped
techbase:Inner Sphere
mass:50
engine:200 Fusion Engine
heat sinks:10 Single
walk mp:4
armor:Standard
CT armor:10
HD armor:9
Weapons:3
Medium Laser, Center Torso
Medium Laser, Center Torso
Medium Laser, Left Arm
`;
const mech = () => convertUnit(parseMtf(MECH, "TIC-1.mtf"));

describe("TIC editor — 'Mech (location facet)", () => {
  it("derives the grouping from the auto-grouped TICs", () => {
    const c = mech();
    expect(groupingFromTics(c.tics, c.weapons)).toEqual([[0, 1], [2]]);
    expect(c.tics.map((t) => t.damageText)).toEqual(["4", "2"]); // 2xML = ceil(10/3); 1xML = 2
  });

  it("splits then merges, recomputing combined damage live", () => {
    const c = mech();
    const split = applyMove(groupingFromTics(c.tics, c.weapons), 1, "new"); // [[0],[2],[1]]
    expect(ticsFromGrouping(c.weapons, split).map((t) => t.damageText)).toEqual(["2", "2", "2"]);
    const merged = applyMove(split, 1, 0); // back to [[0,1],[2]]
    expect(merged).toEqual([[0, 1], [2]]);
    expect(ticsFromGrouping(c.weapons, merged)[0]!.damageText).toBe("4");
  });

  it("offers a legal merge between two same-location TICs in the panel", () => {
    const c = mech();
    const split = applyMove(groupingFromTics(c.tics, c.weapons), 1, "new");
    const html = renderTicEditorHtml(c.weapons, split, mechFacets);
    expect(html).toContain('id="tic-reset"');
    expect(html).toContain("→ TIC"); // the two torso lasers can recombine
  });

  it("refuses cross-location merges (core legality)", () => {
    const c = mech();
    expect(isLegalTic([c.weapons[0]!, c.weapons[1]!])).toBe(true); // both torso
    expect(isLegalTic([c.weapons[0]!, c.weapons[2]!])).toBe(false); // torso + arm
  });
});

// A fighter with one nose laser and one aft laser (different facings).
const FIGHTER = `<UnitType>\nAero\n</UnitType>\n<Name>\nT\n</Name>\n<SafeThrust>\n5\n</SafeThrust>\n<armor>\n40\n24\n24\n16\n</armor>\n<Nose Equipment>\nMedium Laser\n</Nose Equipment>\n<Aft Equipment>\nMedium Laser\n</Aft Equipment>\n`;

describe("TIC editor — vehicle/aero (facing facet)", () => {
  it("retains raw per-arc weapons + auto TICs on the card", () => {
    const c = convertFighter(parseBlkFighter(FIGHTER, "T.blk"));
    expect(c.weaponMounts.map((w) => w.rawLocation)).toEqual(["nose", "aft"]);
    expect(groupingFromTics(c.tics, c.weaponMounts)).toEqual([[0], [1]]);
  });

  it("does NOT offer to merge weapons in different arcs", () => {
    const c = convertFighter(parseBlkFighter(FIGHTER, "T.blk"));
    const html = renderTicEditorHtml(c.weaponMounts, groupingFromTics(c.tics, c.weaponMounts), facingFacets);
    expect(html).not.toContain("→ TIC"); // nose & aft can never share a TIC
  });

  it("rebuilds rows from an edited grouping that matches the converter", () => {
    // Two nose lasers auto-group; rebuilding from that grouping reproduces the row.
    const blk = `<UnitType>\nAero\n</UnitType>\n<Name>\nT2\n</Name>\n<SafeThrust>\n5\n</SafeThrust>\n<armor>\n40\n24\n24\n16\n</armor>\n<Nose Equipment>\nMedium Laser\nMedium Laser\n</Nose Equipment>\n`;
    const c = convertFighter(parseBlkFighter(blk, "T2.blk"));
    expect(c.weapons[0]!.damageText).toBe("4"); // 2x ML combined in the nose
    const g = applyMove(groupingFromTics(c.tics, c.weaponMounts), 1, "new"); // split them
    expect(ticsFromGrouping(c.weaponMounts, g).map((t) => t.damageText)).toEqual(["2", "2"]);
  });
});

describe("TIC editor — caps vs DropShip bays", () => {
  // Six Medium Lasers in one arc, in two groups of three (each at the page-41
  // base cap of 5; a 4th would push base to 7 and exceed it).
  const ml = (rawLocation: string) =>
    convertWeapon({ name: "Medium Laser", location: "X", rawLocation, rearMounted: false }, "IS", 0);
  const weapons = Array.from({ length: 6 }, () => ml("nose"));
  const grouping = [[0, 1, 2], [3, 4, 5]];
  const base = { keyOf: (w: CardWeapon) => w.rawLocation ?? "", facetLabel: (w: CardWeapon) => w.rawLocation ?? "" };
  const capped: EditorFacets = { ...base, enforceCaps: true };
  const bays: EditorFacets = { ...base, enforceCaps: false };

  it("capped facets forbid a merge that would exceed the caps", () => {
    const html = renderTicEditorHtml(weapons, grouping, capped);
    expect(html).toContain("split off"); // splitting is always legal
    expect(html).not.toContain("→ TIC"); // merging the two full groups is blocked
  });

  it("bay (uncapped) facets allow the over-cap merge", () => {
    const html = renderTicEditorHtml(weapons, grouping, bays);
    expect(html).toContain("→ TIC"); // a bay can grow past the 'Mech caps
    // And the merged bay actually sums past the cap.
    const merged = applyMove(grouping, 3, 0); // move one laser into the other group
    expect(ticsFromGrouping(weapons, merged)[0]!.damageText).toBe("7"); // 4x ML = ceil(20/3), over base cap 5
  });
});
