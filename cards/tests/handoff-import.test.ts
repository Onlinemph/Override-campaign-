import { describe, expect, it } from "vitest";

import {
  airEntryNote,
  buildNameIndex,
  normalizeName,
  resolveModel,
  setupNotes,
  type UnitIndexEntry,
} from "../src/web/handoff-import.js";

const INDEX: UnitIndexEntry[] = [
  { name: "Warhammer WHM-6R", path: "Mechs/3025/Warhammer WHM-6R.mtf" },
  { name: "Atlas AS7-D", path: "Mechs/3025/Atlas AS7-D.mtf" },
  { name: "Phoenix Hawk PXH-1", path: "Mechs/3025/Phoenix Hawk PXH-1.mtf" },
  { name: "Achilles", path: "Mechs/3050/Achilles.mtf" },
  { name: "Locust LCT-1V", path: "Mechs/3025/Locust LCT-1V.mtf" },
  { name: "Locust LCT-1M", path: "Mechs/3025/Locust LCT-1M.mtf" },
];

describe("normalizeName", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeName("  Warhammer   WHM-6R ")).toBe("warhammer whm-6r");
  });
});

describe("resolveModel", () => {
  const byName = buildNameIndex(INDEX);

  it("matches an exact model name", () => {
    expect(resolveModel("Warhammer WHM-6R", byName)?.path).toBe(
      "Mechs/3025/Warhammer WHM-6R.mtf",
    );
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveModel("phoenix   hawk pxh-1", byName)?.name).toBe("Phoenix Hawk PXH-1");
  });

  it("strips a trailing parenthetical and matches the chassis", () => {
    expect(resolveModel("Achilles (pocket WarShip)", byName)?.name).toBe("Achilles");
  });

  it("falls back to a unique prefix match", () => {
    // "Atlas" is a prefix of exactly one library name → resolves
    expect(resolveModel("Atlas", byName)?.name).toBe("Atlas AS7-D");
  });

  it("refuses an ambiguous prefix match", () => {
    // "Locust" prefixes two entries → no confident match
    expect(resolveModel("Locust", byName)).toBeNull();
  });

  it("returns null for an unknown model", () => {
    expect(resolveModel("Flatbed Truck", byName)).toBeNull();
  });

  it("returns null for an empty model", () => {
    expect(resolveModel("", byName)).toBeNull();
  });

  it("keeps the first entry when normalized names collide", () => {
    const dupes: UnitIndexEntry[] = [
      { name: "Foo BAR-1", path: "a/Foo BAR-1.mtf" },
      { name: "Foo  BAR-1", path: "b/Foo BAR-1.mtf" },
    ];
    expect(resolveModel("Foo BAR-1", buildNameIndex(dupes))?.path).toBe("a/Foo BAR-1.mtf");
  });
});

describe("setupNotes", () => {
  it("summarizes a ground side's tabletop setup", () => {
    const notes = setupNotes({
      name: "Blue", units: [],
      setup: {
        entryEdge: "SE", deploysFirst: false, initiativeBonus: 2, initiativeBonusTurns: 3,
        hiddenSetup: true, fortified: false, rdyTnPenalty: 1,
        offboard: { artillery: 2, reinforcements: [{ arrivesTurn: 4, edge: "ANY_HALF" }], airOnStation: [] },
      },
    });
    expect(notes).toContain("Entry edge: SE");
    expect(notes).toContain("Deploys second");
    expect(notes).toContain("+2 initiative (3 turns)");
    expect(notes).toContain("Hidden setup");
    expect(notes).toContain("RDY: +1 to all TNs");
    expect(notes).toContain("Off-board artillery: 2");
    expect(notes.some((n) => n.startsWith("Reinforcements: 1"))).toBe(true);
  });

  it("returns nothing when a side has no setup block", () => {
    expect(setupNotes({ name: "X", units: [] })).toEqual([]);
  });
});

describe("airEntryNote", () => {
  it("formats air/space entry state and is empty for ground units", () => {
    expect(airEntryNote({ model: "Shilone", velocity: 4, altLevel: 6, fpOnTable: 240 }))
      .toBe("vel 4 · alt 6 · 240 FP");
    expect(airEntryNote({ model: "Atlas AS7-D" })).toBe("");
  });
});
