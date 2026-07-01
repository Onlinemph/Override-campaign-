import { describe, expect, it } from "vitest";

import {
  battleResultFromForces,
  mapAmmoState,
  mapDamageState,
  mapPilotStatus,
} from "../src/web/handoff-result.js";

describe("mapDamageState", () => {
  it("undamaged → OK", () => {
    expect(mapDamageState(undefined)).toBe("OK");
    expect(mapDamageState({})).toBe("OK");
  });
  it("a dead engine → DESTROYED; merely out of action → SALVAGE", () => {
    expect(mapDamageState({ engine: 2 })).toBe("DESTROYED");
    expect(mapDamageState({ out: true })).toBe("SALVAGE");
    expect(mapDamageState({ out: true, engine: 2 })).toBe("DESTROYED");
  });
  it("a mobility/crew crit → CRIPPLED", () => {
    expect(mapDamageState({ engine: 1 })).toBe("CRIPPLED");
    expect(mapDamageState({ gyro: 1 })).toBe("CRIPPLED");
    expect(mapDamageState({ legHits: 1 })).toBe("CRIPPLED");
  });
  it("armor/heat/ammo only → DAMAGED", () => {
    expect(mapDamageState({ loc: { ct: 2 } })).toBe("DAMAGED");
    expect(mapDamageState({ heat: 3 })).toBe("DAMAGED");
    expect(mapDamageState({ ammo: { "AC/20@LT": 4 } })).toBe("DAMAGED");
  });
  it("zeroed damage maps are not damage", () => {
    expect(mapDamageState({ loc: { ct: 0 }, groups: { g0: 0 } })).toBe("OK");
  });
});

describe("mapPilotStatus", () => {
  it("scales with the condition track", () => {
    expect(mapPilotStatus({ condition: 0 })).toBe("OK");
    expect(mapPilotStatus({ condition: 1 })).toBe("WOUNDED");
    expect(mapPilotStatus({ condition: 3 })).toBe("DOWNED");
  });
});

describe("mapAmmoState", () => {
  it("PARTIAL once anything is spent, else FULL", () => {
    expect(mapAmmoState({})).toBe("FULL");
    expect(mapAmmoState({ ammo: { "LRM@LT": 1 } })).toBe("PARTIAL");
    expect(mapAmmoState({ ammo: { "LRM@LT": 0 } })).toBe("FULL");
  });
});

describe("battleResultFromForces", () => {
  const base = {
    handoffId: "handoff:eng:1",
    you: {
      sideId: "blue",
      units: [
        { campaignUnitId: "u-blue-1", campaignPilotIds: ["p1"], damage: {} },
        { campaignUnitId: "u-blue-2", campaignPilotIds: ["p2"], damage: { loc: { ct: 3 } } },
      ],
    },
    foe: {
      sideId: "red",
      units: [
        { campaignUnitId: "u-red-1", campaignPilotIds: ["p3"], damage: { out: true } },
        { campaignUnitId: "u-red-2", campaignPilotIds: ["p4"], damage: { engine: 2 } },
      ],
    },
    turnsElapsed: 4,
  };

  it("maps every campaign unit to an outcome with pilots", () => {
    const r = battleResultFromForces(base);
    expect(r.handoffId).toBe("handoff:eng:1");
    expect(r.turnsElapsed).toBe(4);
    expect(r.unitOutcomes).toHaveLength(4);
    const red1 = r.unitOutcomes.find((o) => o.unitId === "u-red-1")!; // out:true
    expect(red1.damage).toBe("SALVAGE");
    expect(red1.pilotOutcomes).toEqual([{ pilotId: "p3", status: "OK" }]);
    const red2 = r.unitOutcomes.find((o) => o.unitId === "u-red-2")!; // engine:2
    expect(red2.damage).toBe("DESTROYED");
  });

  it("ejects the conscious crews of dead units (SAR markers)", () => {
    const r = battleResultFromForces(base);
    // both red units are dead with OK crews → both eject; blue units survive
    expect(r.ejections.map((e) => e.pilotId).sort()).toEqual(["p3", "p4"]);
  });

  it("does not eject a downed crew", () => {
    const r = battleResultFromForces({
      ...base,
      foe: { sideId: "red", units: [{ campaignUnitId: "u-red-1", campaignPilotIds: ["p3"], damage: { out: true, condition: 3 } }] },
    });
    expect(r.ejections).toEqual([]);
  });

  it("infers the victor from surviving counts (blue 2 vs red 0)", () => {
    const r = battleResultFromForces(base);
    expect(r.victorSideId).toBe("blue");
    expect(r.hexControlSideId).toBe("blue");
  });

  it("leaves the victor undefined on a survivor tie", () => {
    const tie = {
      ...base,
      foe: { sideId: "red", units: [{ campaignUnitId: "u-red-1", damage: {} }] },
      you: { sideId: "blue", units: [{ campaignUnitId: "u-blue-1", damage: {} }] },
    };
    const r = battleResultFromForces(tie);
    expect(r.victorSideId).toBeUndefined();
    expect(r.hexControlSideId).toBeUndefined();
  });

  it("skips non-campaign units (manual adds without an id)", () => {
    const withManual = {
      ...base,
      you: { sideId: "blue", units: [{ damage: {} }, { campaignUnitId: "u-blue-1", damage: {} }] },
    };
    const r = battleResultFromForces(withManual);
    expect(r.unitOutcomes.filter((o) => o.unitId.startsWith("u-blue")).length).toBe(1);
  });
});
