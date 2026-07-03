/** CAS to the table (ext): flights on ground-attack missions appear as off-board air. */
import { describe, expect, it } from 'vitest';
import { buildHandoff } from '../../src/handoff/export.js';
import { SKYWATCH } from '../../src/rules.js';
import { addFlight, addMechFormation, baseTruth, gp } from '../helpers.js';
import type { Engagement, Order, TruthState } from '../../src/core/types.js';

function casOrder(truth: TruthState, id: string, formationId: string, kind: Order['kind']) {
  truth.orders[id] = { id, sideId: 'blue', formationId, issuedTick: 0, effectiveTick: 0,
                       kind, conditionals: [] };
  truth.formations[formationId].currentOrderId = id;
}

function groundEngagement(): Engagement {
  return {
    id: 'eng:test', tick: 0, hex: gp(5, 5), trigger: 'SAME_HEX',
    attackerSideId: 'red', defenderSideId: 'blue',
    attackerFormationIds: ['red-1'], defenderFormationIds: ['blue-1'], status: 'PENDING',
  };
}

describe('handoff — off-board air support', () => {
  function battlefield() {
    const truth = baseTruth('CAS-SEED');
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(5, 5) });
    addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(5, 5) });
    return truth;
  }

  it('a CAS flight over the theater is listed as overhead with its fuel state', () => {
    const truth = battlefield();
    // D-037 congruent sky: "overhead" means over the battle hex (5,5) itself
    addFlight(truth, { id: 'cas1', sideId: 'blue', airPos: { q: 5, r: 5 }, fp: 220 });
    casOrder(truth, 'o-cas', 'cas1', 'CAS');
    const pkg = buildHandoff(truth, groundEngagement());
    const blue = pkg.perSide.find(p => p.sideId === 'blue')!;
    expect(blue.offboard.airOnStation).toEqual([
      { formationId: 'cas1', arrivesTurn: 0, fpOnStation: 220 },
    ]);
    // the enemy does not get our air support
    const red = pkg.perSide.find(p => p.sideId === 'red')!;
    expect(red.offboard.airOnStation).toEqual([]);
  });

  it('a distant STRIKE_AIR flight arrives in later turns; beyond call range is excluded', () => {
    const truth = battlefield();
    const nearDist = SKYWATCH.CAS_ON_CALL.HEXES_PER_TURN + 2;      // ~2 turns at ST 4
    // arrival timing reads the card: ST 4 cruises 12 hexes/turn ⇒ 14 hexes = 2 turns
    // (distances measured from over the battle hex at 5,5 — D-037)
    addFlight(truth, { id: 'near', sideId: 'blue', airPos: { q: 5 + nearDist, r: 5 }, fp: 300,
                       safeThrust: 4 });
    casOrder(truth, 'o-near', 'near', 'STRIKE_AIR');
    addFlight(truth, { id: 'far', sideId: 'blue',
      airPos: { q: 5 + SKYWATCH.CAS_ON_CALL.MAX_AIR_HEXES + 5, r: 5 }, fp: 300 });
    casOrder(truth, 'o-far', 'far', 'CAS');
    const pkg = buildHandoff(truth, groundEngagement());
    const blue = pkg.perSide.find(p => p.sideId === 'blue')!;
    expect(blue.offboard.airOnStation.map(a => a.formationId)).toEqual(['near']);
    expect(blue.offboard.airOnStation[0].arrivesTurn).toBe(2);
  });

  it('air-to-air missions do not count as ground support', () => {
    const truth = battlefield();
    addFlight(truth, { id: 'cap1', sideId: 'blue', airPos: { q: 0, r: 0 }, fp: 300 });
    casOrder(truth, 'o-cap', 'cap1', 'CAP');
    const pkg = buildHandoff(truth, groundEngagement());
    expect(pkg.perSide.find(p => p.sideId === 'blue')!.offboard.airOnStation).toEqual([]);
  });
});
