/** Player carrier orders (ext): EMBARK / DISEMBARK / LIFT_OFF / LAND through the engine. */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { CLOCK, SKYWATCH } from '../../src/rules.js';
import { addFlight, addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

function activate(truth: TruthState, order: Order) {
  truth.orders[order.id] = order;
  truth.formations[order.formationId].currentOrderId = order.id;
}

function steps(c: Campaign, n: number) {
  for (let i = 0; i < n; i++) c.step();
}

function carrierTruth(seed: string) {
  const truth = baseTruth(seed);
  const ds = addMechFormation(truth, { id: 'ds1', sideId: 'blue', pos: gp(10, 10) },
    1, { class: 'DROPSHIP' });
  ds.carrier = { bays: 2, crews: 1, avFuelTons: 40 };
  return truth;
}

describe('EMBARK — march to the carrier and load', () => {
  it('a lance marches to the DropShip hex and loads into a bay', () => {
    const truth = carrierTruth('EMBARK-1');
    const lance = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(6, 10), omp: 8 });
    activate(truth, { ...moveOrder('o1', lance, 'MOVE', []), kind: 'EMBARK',
                      targetFormationId: 'ds1', path: [] });
    const c = Campaign.create(truth);

    steps(c, 8);
    expect(c.truth.formations['m1'].mounted?.carrierFormationId).toBe('ds1');
    expect(c.truth.formations['m1'].pos).toEqual(c.truth.formations['ds1'].pos);
    expect(c.truth.orders['o1'].completed).toBe(true);
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('waits at the ramp when the bays are full; fizzles on a non-carrier target', () => {
    const truth = carrierTruth('EMBARK-2');
    truth.formations['ds1'].carrier!.bays = 1;
    const a = addMechFormation(truth, { id: 'a', sideId: 'blue', pos: gp(10, 10) });
    a.mounted = { carrierFormationId: 'ds1' }; // bay already taken
    const b = addMechFormation(truth, { id: 'b', sideId: 'blue', pos: gp(10, 10) });
    activate(truth, { ...moveOrder('ob', b, 'MOVE', []), kind: 'EMBARK',
                      targetFormationId: 'ds1', path: [] });
    const other = addMechFormation(truth, { id: 'x', sideId: 'blue', pos: gp(3, 3) });
    activate(truth, { ...moveOrder('ox', other, 'MOVE', []), kind: 'EMBARK',
                      targetFormationId: 'b', path: [] }); // b is no carrier
    const c = Campaign.create(truth);

    steps(c, 3);
    expect(c.truth.formations['b'].mounted).toBeUndefined();  // still at the ramp
    expect(c.truth.orders['ob'].completed).toBeUndefined();   // order stays open
    expect(c.truth.orders['ox'].completed).toBe(true);        // fizzled cleanly
  });
});

describe('DISEMBARK — step off a landed carrier', () => {
  it('unloads into the chosen adjacent hex and completes', () => {
    const truth = carrierTruth('DISEM-1');
    const m = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(10, 10) });
    m.mounted = { carrierFormationId: 'ds1' };
    activate(truth, { ...moveOrder('o1', m, 'MOVE', []), kind: 'DISEMBARK',
                      targetHex: gp(11, 10), path: [] });
    const c = Campaign.create(truth);

    steps(c, 2);
    expect(c.truth.formations['m1'].mounted).toBeUndefined();
    expect(c.truth.formations['m1'].pos).toEqual(gp(11, 10));
    expect(c.truth.orders['o1'].completed).toBe(true);
    expect(replay(c.store.all())).toEqual(c.truth);
  });
});

describe('LIFT_OFF / LAND — a DropShip flies itself', () => {
  function flyingDropship(seed: string) {
    const truth = carrierTruth(seed);
    const ds = truth.formations['ds1'];
    ds.air = { phase: 'GROUNDED', speed: 'CRUISE' }; // it's a flight: it can fly
    const u = truth.units[ds.unitIds[0]];
    u.safeThrust = 3;
    u.fuel = { fp: 4000, fpPerTon: 30, tons: 4000 / 30 }; // deep tanks: holding costs loiter
    return truth;
  }

  it('LIFT_OFF launches and holds at altitude — no sneaking home to land', () => {
    const truth = flyingDropship('LIFT-1');
    const ds = truth.formations['ds1'];
    activate(truth, { ...moveOrder('o1', ds, 'MOVE', []), kind: 'LIFT_OFF', path: [] });
    const c = Campaign.create(truth);

    // launch delay (STAND_DOWN board) then airborne, holding
    steps(c, 30);
    const f = c.truth.formations['ds1'];
    expect(f.pos.kind).toBe('air');
    expect(f.air?.phase).toBe('ON_STATION');
    expect(c.truth.orders['o1'].completed).toBeUndefined(); // standing order: still holding
    const fpAfterLaunch = c.truth.units[f.unitIds[0]].fuel!.fp;
    expect(fpAfterLaunch).toBeLessThan(4000); // paid takeoff + climb + loiter

    steps(c, 3);
    expect(c.truth.formations['ds1'].pos.kind).toBe('air'); // still up, still holding
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('an embarked lance rides the whole flight and lands with the ship (LAND on a bare hex)', () => {
    const truth = flyingDropship('LAND-1');
    const m = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(10, 10) });
    m.mounted = { carrierFormationId: 'ds1' };
    const ds = truth.formations['ds1'];
    activate(truth, { ...moveOrder('o1', ds, 'MOVE', []), kind: 'LIFT_OFF', path: [] });
    const c = Campaign.create(truth);
    steps(c, 30);
    expect(c.truth.formations['ds1'].pos.kind).toBe('air');
    expect(c.truth.formations['m1'].pos.kind).toBe('air'); // cargo rode along

    // now put down across the map — no facility there, just open ground
    // (injected via the log: this test truth has no command net to route through)
    c.inject({ type: 'ORDER_ISSUED', order: { id: 'o2', sideId: 'blue', formationId: 'ds1',
      issuedTick: c.truth.tick, effectiveTick: c.truth.tick + 1,
      kind: 'LAND', targetHex: gp(20, 5), conditionals: [] } });
    steps(c, 8);
    const f = c.truth.formations['ds1'];
    expect(f.pos).toEqual(gp(20, 5));
    expect(f.air?.phase).toBe('GROUNDED');
    expect(c.truth.formations['m1'].pos).toEqual(gp(20, 5)); // cargo landed with it
    expect(c.truth.orders['o2'].completed).toBe(true);
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('LAND refuses impassable terrain: the order completes and the ship stays aloft', () => {
    const truth = flyingDropship('LAND-2');
    // put a water hex at the target
    const t = truth.theaters['theater-1'];
    t.hexes['4,4'] = { ...t.hexes['4,4'], terrain: 'WATER' };
    const ds = truth.formations['ds1'];
    ds.pos = { kind: 'air', gridQ: 0, gridR: 0, band: 'HIGH', altLevel: 6,
               velocity: 2, vectorDeg: 0 };
    ds.air = { phase: 'ENROUTE', speed: 'CRUISE' };
    activate(truth, { ...moveOrder('o1', ds, 'MOVE', []), kind: 'LAND',
                      targetHex: gp(4, 4), path: [] });
    const c = Campaign.create(truth);
    steps(c, 4);
    expect(c.truth.orders['o1'].completed).toBe(true);
    expect(c.truth.formations['ds1'].pos.kind).toBe('air'); // waved off
  });
});

describe('scramble from the bay — a stowed flight with an air order launches itself', () => {
  it('clears the mount, homes on the carrier, and flies its mission', () => {
    const truth = carrierTruth('SCRAMBLE-1');
    const flt = addFlight(truth, { id: 'f1', sideId: 'blue', basePos: gp(10, 10), fp: 300 });
    flt.mounted = { carrierFormationId: 'ds1' };
    activate(truth, { ...moveOrder('o1', flt, 'MOVE', []), kind: 'CAP', path: [],
                      station: { kind: 'air', gridQ: 2, gridR: 2, band: 'HIGH',
                                 altLevel: 6, velocity: 0, vectorDeg: 0 },
                      loiterTicks: 10 });
    const c = Campaign.create(truth);

    steps(c, 3);
    const f = c.truth.formations['f1'];
    expect(f.mounted).toBeUndefined();
    expect(f.pos.kind).toBe('air');
    expect(f.air?.homeCarrierId).toBe('ds1');
    expect(replay(c.store.all())).toEqual(c.truth);
  });
});
