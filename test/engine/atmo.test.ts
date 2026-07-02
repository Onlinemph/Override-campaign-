/** The orbit ↔ ground seam (ext): DESCEND / ASCEND, and carrier auto-recovery. */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { ATMO } from '../../src/rules.js';
import {
  addFlight, addMechFormation, addSystem, addVessel, baseTruth, gp, moveOrder, T,
} from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

function activate(truth: TruthState, order: Order) {
  truth.orders[order.id] = order;
  truth.formations[order.formationId].currentOrderId = order.id;
}

function steps(c: Campaign, n: number) {
  for (let i = 0; i < n; i++) c.step();
}

/** A planet node embedding the test theater, with a DropShip carrier parked in orbit. */
function orbitTruth(seed: string) {
  const truth = baseTruth(seed);
  addSystem(truth, [
    { id: 'planet', type: 'PLANET', theaterId: T },
    { id: 'zenith', type: 'JUMP_ZENITH' },
  ], [['zenith', 'planet', 10]]);
  const ds = addVessel(truth, { id: 'ds1', sideId: 'blue', nodeId: 'planet', tons: 300 });
  ds.carrier = { bays: 2, crews: 1, avFuelTons: 40 };
  ds.air = { phase: 'GROUNDED', speed: 'CRUISE' };
  const u = truth.units[ds.unitIds[0]];
  u.fuel!.fp = 4000; u.fuel!.fpPerTon = 30;
  return truth;
}

describe('DESCEND — orbit to the air layer', () => {
  it('re-enters after ATMO.DESCENT_TICKS into the theater air hex, cargo riding along', () => {
    const truth = orbitTruth('DESCEND-1');
    const lance = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 5) });
    lance.mounted = { carrierFormationId: 'ds1' };
    const ds = truth.formations['ds1'];
    activate(truth, { ...moveOrder('o1', ds, 'MOVE', []), kind: 'DESCEND', path: [] });
    const c = Campaign.create(truth);

    steps(c, ATMO.DESCENT_TICKS + 3);
    const f = c.truth.formations['ds1'];
    expect(f.pos.kind).toBe('air'); // holding in the HIGH band awaiting orders
    expect(c.truth.orders['o1'].completed).toBe(true);
    expect(c.truth.formations['m1'].pos).toEqual(f.pos); // the lance came down inside
    const fp = c.truth.units[f.unitIds[0]].fuel!.fp;
    expect(fp).toBe(4000 - ATMO.DESCENT_FP);
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('fizzles at a node with no theater below', () => {
    const truth = orbitTruth('DESCEND-2');
    const ds = truth.formations['ds1'];
    ds.pos = { kind: 'node', nodeId: 'zenith' }; // nothing down there
    activate(truth, { ...moveOrder('o1', ds, 'MOVE', []), kind: 'DESCEND', path: [] });
    const c = Campaign.create(truth);
    steps(c, 3);
    expect(c.truth.orders['o1'].completed).toBe(true);
    expect(c.truth.formations['ds1'].pos.kind).toBe('node'); // still in orbit
  });
});

describe('ASCEND — climbing the well', () => {
  it('a grounded DropShip lifts, climbs, and arrives at the planet node', () => {
    const truth = orbitTruth('ASCEND-1');
    const ds = truth.formations['ds1'];
    ds.pos = gp(10, 10); // parked on the surface
    activate(truth, { ...moveOrder('o1', ds, 'MOVE', []), kind: 'ASCEND', path: [] });
    const c = Campaign.create(truth);

    steps(c, 40); // launch delay + climb
    const f = c.truth.formations['ds1'];
    expect(f.pos).toEqual({ kind: 'node', nodeId: 'planet' });
    expect(c.truth.orders['o1'].completed).toBe(true);
    const fp = c.truth.units[f.unitIds[0]].fuel!.fp;
    expect(fp).toBeLessThan(4000 - ATMO.ASCENT_FP); // takeoff + climb + the ascent burn
    expect(replay(c.store.all())).toEqual(c.truth);
  });
});

describe('carrier auto-recovery — RTB ends in the bay, not a hover', () => {
  it('a carrier-based flight recovers itself when its mission completes', () => {
    const truth = orbitTruth('RECOVER-1');
    const ds = truth.formations['ds1'];
    ds.pos = gp(10, 10); // carrier landed
    const flt = addFlight(truth, { id: 'f1', sideId: 'blue',
      airPos: { q: 0, r: 0 }, fp: 300 });
    flt.air = { ...flt.air!, homeCarrierId: 'ds1', phase: 'RTB' };
    const c = Campaign.create(truth);

    steps(c, 4);
    const f = c.truth.formations['f1'];
    expect(f.mounted?.carrierFormationId).toBe('ds1'); // stowed, not hovering
    expect(f.pos).toEqual(gp(10, 10));
    expect(f.air?.phase).toBe('GROUNDED');
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('waves off when the bays are full — holds over the ship instead', () => {
    const truth = orbitTruth('RECOVER-2');
    const ds = truth.formations['ds1'];
    ds.pos = gp(10, 10);
    ds.carrier!.bays = 1;
    const cargo = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(10, 10) });
    cargo.mounted = { carrierFormationId: 'ds1' }; // the one bay is taken
    const flt = addFlight(truth, { id: 'f1', sideId: 'blue',
      airPos: { q: 0, r: 0 }, fp: 300 });
    flt.air = { ...flt.air!, homeCarrierId: 'ds1', phase: 'RTB' };
    const c = Campaign.create(truth);

    steps(c, 4);
    expect(c.truth.formations['f1'].mounted).toBeUndefined(); // waved off
    expect(c.truth.formations['f1'].pos.kind).toBe('air');
  });
});

describe('the full chain — jump point to dirt and back out, all plotted orders', () => {
  it('DESCEND → LAND → DISEMBARK → fighter CAP off the deck → auto-recover → ASCEND', () => {
    const truth = orbitTruth('CHAIN-1');
    const lance = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 5) });
    lance.mounted = { carrierFormationId: 'ds1' };
    const flt = addFlight(truth, { id: 'f1', sideId: 'blue', basePos: gp(5, 5), fp: 300 });
    flt.mounted = { carrierFormationId: 'ds1' };
    const ds = truth.formations['ds1'];
    activate(truth, { ...moveOrder('o1', ds, 'MOVE', []), kind: 'DESCEND', path: [] });
    const c = Campaign.create(truth);

    // 1. re-entry
    steps(c, ATMO.DESCENT_TICKS + 2);
    expect(c.truth.formations['ds1'].pos.kind).toBe('air');

    // 2. put down on an open hex
    c.inject({ type: 'ORDER_ISSUED', order: { id: 'o2', sideId: 'blue', formationId: 'ds1',
      issuedTick: c.truth.tick, effectiveTick: c.truth.tick + 1,
      kind: 'LAND', targetHex: gp(12, 8), conditionals: [] } });
    steps(c, 5);
    expect(c.truth.formations['ds1'].pos).toEqual(gp(12, 8));

    // 3. the lance walks off the ramp
    c.inject({ type: 'ORDER_ISSUED', order: { id: 'o3', sideId: 'blue', formationId: 'm1',
      issuedTick: c.truth.tick, effectiveTick: c.truth.tick + 1,
      kind: 'DISEMBARK', targetHex: gp(13, 8), conditionals: [] } });
    steps(c, 3);
    expect(c.truth.formations['m1'].mounted).toBeUndefined();
    expect(c.truth.formations['m1'].pos).toEqual(gp(13, 8));

    // 4. the fighter scrambles off the deck for a short CAP…
    c.inject({ type: 'ORDER_ISSUED', order: { id: 'o4', sideId: 'blue', formationId: 'f1',
      issuedTick: c.truth.tick, effectiveTick: c.truth.tick + 1,
      kind: 'CAP', conditionals: [],
      station: { kind: 'air', gridQ: 1, gridR: 1, band: 'HIGH', altLevel: 6,
                 velocity: 0, vectorDeg: 0 },
      loiterTicks: 2 } });
    steps(c, 4);
    expect(c.truth.formations['f1'].pos.kind).toBe('air');
    expect(c.truth.formations['f1'].air?.homeCarrierId).toBe('ds1');

    // …and recovers itself into the bay when the mission runs out
    steps(c, 12);
    expect(c.truth.formations['f1'].mounted?.carrierFormationId).toBe('ds1');
    expect(c.truth.formations['f1'].air?.phase).toBe('GROUNDED');

    // 5. buttoned up: climb back to orbit, fighter riding along
    c.inject({ type: 'ORDER_ISSUED', order: { id: 'o5', sideId: 'blue', formationId: 'ds1',
      issuedTick: c.truth.tick, effectiveTick: c.truth.tick + 1,
      kind: 'ASCEND', conditionals: [] } });
    steps(c, 40);
    expect(c.truth.formations['ds1'].pos).toEqual({ kind: 'node', nodeId: 'planet' });
    expect(c.truth.formations['f1'].pos).toEqual({ kind: 'node', nodeId: 'planet' });

    expect(replay(c.store.all())).toEqual(c.truth); // the whole story, byte-exact
  });
});
