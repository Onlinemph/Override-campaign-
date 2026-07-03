/** Carrier ops — embark/disembark, launch/recover, and carrier rearm (ext). */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { addFlight, addMechFormation, baseTruth, gp } from '../helpers.js';
import { SKYWATCH, CLOCK } from '../../src/rules.js';

function carrierTruth(seed = 'CARRIER') {
  const truth = baseTruth(seed, [], 30, 20);
  const carrier = addMechFormation(truth, { id: 'ds1', sideId: 'blue', pos: gp(10, 10) },
    1, { class: 'DROPSHIP' });
  carrier.carrier = { bays: 2, crews: 1, avFuelTons: 40 };
  return truth;
}

describe('carrier ops — embark / disembark', () => {
  it('embarks a co-located friendly formation and rides it along', () => {
    const truth = carrierTruth();
    addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(10, 10) });
    const c = Campaign.create(truth);

    expect(c.embark('ds1', 'm1').ok).toBe(true);
    expect(c.truth.formations['m1'].mounted?.carrierFormationId).toBe('ds1');
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('refuses embark when not co-located, wrong side, or bays full', () => {
    const truth = carrierTruth();
    addMechFormation(truth, { id: 'far', sideId: 'blue', pos: gp(2, 2) });
    addMechFormation(truth, { id: 'foe', sideId: 'red', pos: gp(10, 10) });
    addMechFormation(truth, { id: 'a', sideId: 'blue', pos: gp(10, 10) });
    addMechFormation(truth, { id: 'b', sideId: 'blue', pos: gp(10, 10) });
    addMechFormation(truth, { id: 'c', sideId: 'blue', pos: gp(10, 10) });
    const camp = Campaign.create(truth);

    expect(camp.embark('ds1', 'far').ok).toBe(false);
    expect(camp.embark('ds1', 'foe').ok).toBe(false);
    expect(camp.embark('ds1', 'a').ok).toBe(true);
    expect(camp.embark('ds1', 'b').ok).toBe(true);
    const full = camp.embark('ds1', 'c');
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.reason).toMatch(/bays/);
  });

  it('disembarks onto an adjacent hex when the carrier is landed', () => {
    const truth = carrierTruth();
    const m = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(10, 10) });
    m.mounted = { carrierFormationId: 'ds1' };
    const c = Campaign.create(truth);

    const r = c.disembark('m1', gp(11, 10));
    expect(r.ok).toBe(true);
    expect(c.truth.formations['m1'].mounted).toBeUndefined();
    expect(c.truth.formations['m1'].pos).toEqual(gp(11, 10));
    // too far is refused
    const m2 = c.truth.formations['m1'];
    m2.mounted = { carrierFormationId: 'ds1' };
    m2.pos = gp(10, 10);
    expect(c.disembark('m1', gp(20, 20)).ok).toBe(false);
  });

  it('the carrier drags an embarked lance as it moves (carry pass on step)', () => {
    const truth = carrierTruth();
    truth.formations['ds1'].omp = 20; // a fast run so it clears hexes in one step
    const m = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(10, 10) });
    m.mounted = { carrierFormationId: 'ds1' };
    // the carrier drives east under its own order; the embarked lance must track it
    truth.orders['o1'] = { id: 'o1', sideId: 'blue', formationId: 'ds1', issuedTick: 0,
      effectiveTick: 0, kind: 'MOVE', path: [gp(14, 10)], conditionals: [] };
    truth.formations['ds1'].currentOrderId = 'o1';
    const c = Campaign.create(truth);

    c.step();
    const dsPos = c.truth.formations['ds1'].pos as { q: number; r: number };
    expect(dsPos.q).toBeGreaterThan(10);               // carrier moved
    expect(c.truth.formations['m1'].pos).toEqual(c.truth.formations['ds1'].pos); // lance rode along
    expect(replay(c.store.all())).toEqual(c.truth);
  });
});

describe('carrier ops — launch / recover / rearm', () => {
  it('launches an embarked flight into the theater air band, homed on the carrier', () => {
    const truth = carrierTruth();
    const flt = addFlight(truth, { id: 'f1', sideId: 'blue', basePos: gp(10, 10), fp: 100 });
    flt.mounted = { carrierFormationId: 'ds1' };
    const c = Campaign.create(truth);

    const r = c.launchFromCarrier('ds1', 'f1');
    expect(r.ok).toBe(true);
    const f = c.truth.formations['f1'];
    expect(f.mounted).toBeUndefined();
    expect(f.pos.kind).toBe('air');
    expect(f.air?.homeCarrierId).toBe('ds1');
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('recovers an airborne flight co-located with the carrier, then rearms it', () => {
    const truth = carrierTruth();
    // D-037 congruent sky: recovery needs the flight in the hex directly over the ship
    const flt = addFlight(truth, { id: 'f1', sideId: 'blue',
      airPos: { q: 10, r: 10 }, fp: 20, tons: 5 });
    flt.air = { ...flt.air!, homeCarrierId: 'ds1' };
    const c = Campaign.create(truth);

    const rec = c.recoverToCarrier('ds1', 'f1');
    expect(rec.ok).toBe(true);
    expect(c.truth.formations['f1'].mounted?.carrierFormationId).toBe('ds1');

    const before = c.truth.formations['f1'].unitIds
      .reduce((s, uid) => s + (c.truth.units[uid]?.fuel?.fp ?? 0), 0);
    const rearm = c.carrierRearm('ds1', 'f1');
    expect(rearm.ok).toBe(true);
    if (!rearm.ok) return;
    // fuel topped to capacity; carrier av fuel drawn down
    const u = c.truth.units[c.truth.formations['f1'].unitIds[0]];
    expect(u.fuel!.fp).toBe(Math.round(u.fuel!.tons * u.fuel!.fpPerTon));
    expect(u.fuel!.fp).toBeGreaterThan(before);
    expect(c.truth.formations['ds1'].carrier!.avFuelTons).toBeLessThan(40);
    expect(rearm.readyTick).toBe(SKYWATCH.TURNAROUND_PULSES * CLOCK.TICKS_PER_PULSE);
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('refuses to launch a flight mid-rearm (turnaround crew still working)', () => {
    const truth = carrierTruth();
    const flt = addFlight(truth, { id: 'f1', sideId: 'blue', basePos: gp(10, 10), fp: 20, tons: 5 });
    flt.mounted = { carrierFormationId: 'ds1' };
    const c = Campaign.create(truth);

    expect(c.carrierRearm('ds1', 'f1').ok).toBe(true);
    const r = c.launchFromCarrier('ds1', 'f1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/turnaround/);
  });

  it('refuses to rearm a flight that is not aboard, and honours the single crew', () => {
    const truth = carrierTruth();
    const a = addFlight(truth, { id: 'f1', sideId: 'blue', basePos: gp(10, 10), fp: 20, tons: 5 });
    a.mounted = { carrierFormationId: 'ds1' };
    const b = addFlight(truth, { id: 'f2', sideId: 'blue', basePos: gp(10, 10), fp: 20, tons: 5 });
    b.mounted = { carrierFormationId: 'ds1' };
    const c = Campaign.create(truth);

    expect(c.carrierRearm('ds1', 'f1').ok).toBe(true);   // takes the one crew
    const second = c.carrierRearm('ds1', 'f2');
    expect(second.ok).toBe(false);                        // crew busy
    if (!second.ok) expect(second.reason).toMatch(/crew/);
  });
});
