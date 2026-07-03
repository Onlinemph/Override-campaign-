/** M3 — flight ledger engine, alerts, chase, thresholds, turnaround (SKYWATCH). */
import { describe, expect, it } from 'vitest';
import { Campaign } from '../../src/core/truth.js';
import { rollDice } from '../../src/core/rng.js';
import {
  computeAirSig, cruiseHexesPerTick, dashHexesPerTick, jokerBingo, minFp,
  rtbDistance, transitFpPerHex,
} from '../../src/engine/air.js';
import { CLOCK } from '../../src/rules.js';
import { addFlight, addMechFormation, baseTruth, gp, mkFacility, moveOrder, T } from '../helpers.js';
import type { AirPos, Order, TruthState } from '../../src/core/types.js';

function withAirbase(truth: TruthState, q = 5, r = 5, farmTons = 20, id = 'base') {
  truth.facilities[id] = mkFacility({
    id, sideId: 'blue', name: 'Airbase', pos: gp(q, r),
    tags: ['AIRSTRIP'], fuelFarmTons: farmTons,
    turnaroundCrews: { total: 1, busyUntil: [] },
  });
  return truth.facilities[id];
}

function airOrder(id: string, formationId: string, kind: Order['kind'],
                  extra: Partial<Order> = {}): Order {
  return { id, sideId: 'blue', formationId, issuedTick: 0, effectiveTick: 0,
           kind, conditionals: [], ...extra };
}

const station = (q: number, r: number): AirPos =>
  ({ kind: 'air', gridQ: q, gridR: r, band: 'HIGH', altLevel: 6, velocity: 0, vectorDeg: 0 });

describe('M3 — ledger math (pure helpers)', () => {
  it('rates come off the card: cruise = ST×3, dash = ST×6 hexes/CT; costs 1 / 2 FP per hex', () => {
    const truth = baseTruth();
    const f = addFlight(truth, { id: 'f', sideId: 'blue', basePos: gp(5, 5), safeThrust: 6 });
    expect(cruiseHexesPerTick(truth, f)).toBe(18); // ST 6: a hot ship loafs faster
    expect(dashHexesPerTick(truth, f)).toBe(36);
    const slow = addFlight(truth, { id: 's', sideId: 'blue', basePos: gp(6, 5), safeThrust: 4 });
    expect(cruiseHexesPerTick(truth, slow)).toBe(12); // ST 4 = the old doctrinal 12
    expect(transitFpPerHex(truth, f, 'CRUISE')).toBe(1);
    expect(transitFpPerHex(truth, f, 'DASH')).toBe(2);
  });

  it('conventional fighters pay half for transit', () => {
    const truth = baseTruth();
    const f = addFlight(truth, { id: 'c', sideId: 'blue', basePos: gp(5, 5),
                                 klass: 'CONV_FIGHTER', safeThrust: 4 });
    expect(transitFpPerHex(truth, f, 'CRUISE')).toBe(0.5);
    expect(transitFpPerHex(truth, f, 'DASH')).toBe(1);
  });

  it('JOKER/BINGO from RTB distance: 36 hexes ⇒ joker 90, bingo 39.6 (§12)', () => {
    const truth = baseTruth();
    const f = addFlight(truth, { id: 'f', sideId: 'blue', basePos: gp(5, 5) });
    const { joker, bingo } = jokerBingo(truth, f, 36);
    expect(joker).toBe(90);
    expect(bingo).toBeCloseTo(39.6);
  });

  it('carrier ops: RTB tracks a moving DropShip carrier', () => {
    const truth = baseTruth('CARRIER');
    const carrier = addFlight(truth, { id: 'carrier', sideId: 'blue', airPos: { q: 0, r: 0 } });
    const flight = addFlight(truth, { id: 'flt', sideId: 'blue', airPos: { q: 10, r: 0 } });
    flight.air!.homeCarrierId = 'carrier';

    expect(rtbDistance(truth, flight)).toBe(10);         // RTB to the carrier's hex
    const far = jokerBingo(truth, flight);

    carrier.pos = { ...carrier.pos, gridQ: 4 } as typeof carrier.pos; // carrier closes in
    expect(rtbDistance(truth, flight)).toBe(6);
    const near = jokerBingo(truth, flight);
    expect(near.joker).toBeLessThan(far.joker);          // shorter RTB ⇒ smaller joker

    carrier.destroyed = true;                            // carrier lost — no mobile home
    expect(rtbDistance(truth, flight)).toBe(0);          // falls back (no facility)
  });
});

describe('M3 — scramble & the alert board', () => {
  function alertFixture(alertState: 'ALERT5' | 'ALERT15' | 'ALERT60') {
    const truth = baseTruth('AIR-ALERT');
    withAirbase(truth);
    const hq = addMechFormation(truth, { id: 'hq', sideId: 'blue', pos: gp(5, 6) });
    truth.sides['blue'].commandNodes = ['hq'];
    const f = addFlight(truth, { id: 'flt', sideId: 'blue', basePos: gp(5, 5),
                                 homeFacilityId: 'base', withPilots: true, count: 1 });
    const campaign = Campaign.create(truth);
    campaign.setAlertState('flt', alertState);
    return campaign;
  }

  it('launch pays takeoff + climb and applies the alert delay (ALERT-15: next CT)', () => {
    const c = alertFixture('ALERT15');
    c.inject({ type: 'ORDER_ISSUED', order: airOrder('o', 'flt', 'CAP',
      { station: station(0, 0), airSpeed: 'CRUISE', issuedTick: c.truth.tick }) });
    // issuedTick 0 + delay 1 ⇒ airborne after the t1 step
    c.step(); // t0: order activates, launch gated to t1
    expect(c.truth.formations['flt'].pos.kind).toBe('ground');
    c.step(); // t1: runway takeoff (4) + climb to HIGH (12)
    const f = c.truth.formations['flt'];
    expect(f.pos.kind).toBe('air');
    expect(minFp(c.truth, f)).toBe(400 - 4 - 12);
    expect(f.air?.phase).toBe('ENROUTE');
    // sortie fatigue +1 (§11)
    expect(c.truth.pilots['flt-pilot-1'].fatigue).toBe(1);
  });

  it('ALERT-15 accrues ½ fatigue per pulse standing the alert (D-010.1)', () => {
    const c = alertFixture('ALERT15');
    c.step(); // a quiet WATCH step: 60 ticks = 6 pulses on cockpit alert
    expect(c.truth.tick).toBe(60);
    expect(c.truth.pilots['flt-pilot-1'].fatigue).toBe(6 * 0.5);
  });

  it('ALERT-5 burns 5 FP/pulse keeping engines hot, and wears the crew at 1/pulse', () => {
    const c = alertFixture('ALERT5');
    c.step(); // 6 pulses
    expect(minFp(c.truth, c.truth.formations['flt'])).toBe(400 - 6 * 5);
    expect(c.truth.pilots['flt-pilot-1'].fatigue).toBe(6);
  });

  it('STAND_DOWN recovers fatigue: a full day clears 4', () => {
    const c = alertFixture('ALERT15');
    c.truth.pilots['flt-pilot-1'].fatigue = 6;
    c.setAlertState('flt', 'STAND_DOWN');
    while (c.truth.tick < CLOCK.TICKS_PER_DAY) c.step();
    expect(c.truth.pilots['flt-pilot-1'].fatigue).toBe(2);
  });

  it('grounded crews (fatigue ≥7) cannot launch', () => {
    const c = alertFixture('ALERT5');
    c.truth.pilots['flt-pilot-1'].fatigue = 7;
    c.inject({ type: 'ORDER_ISSUED', order: airOrder('o', 'flt', 'CAP',
      { station: station(0, 0), issuedTick: c.truth.tick }) });
    for (let i = 0; i < 5; i++) c.step();
    expect(c.truth.formations['flt'].pos.kind).toBe('ground'); // flight surgeon says no
  });
});

describe('M3 — CAP, loiter & fuel thresholds', () => {
  it('CAP: transit out, loiter on station at 12 FP/CT, then egress home at bingo', () => {
    const truth = baseTruth('AIR-CAP');
    withAirbase(truth);
    const f = addFlight(truth, { id: 'flt', sideId: 'blue', basePos: gp(5, 5),
                                 homeFacilityId: 'base', fp: 100 });
    f.alertState = 'ALERT5';
    const c = Campaign.create(truth);
    // D-037 congruent sky: launch is over the base hex (5,5); station 3 hexes east
    c.inject({ type: 'ORDER_ISSUED', order: airOrder('o', 'flt', 'CAP',
      { station: station(8, 5), issuedTick: 0 }) });

    let guard = 0;
    while (c.truth.formations['flt'].air?.phase !== 'ON_STATION' && guard++ < 10) c.step();
    expect(c.truth.formations['flt'].air?.phase).toBe('ON_STATION');
    // 100 − takeoff 4 − climb 12 − 3 hexes out = 81 on arrival
    expect(minFp(c.truth, c.truth.formations['flt'])).toBe(81);

    // loiter burns 12 FP/CT; bingo home (3 hexes ⇒ 3 × 1.1 = 3.3) eventually forces RTB
    guard = 0;
    while (c.truth.formations['flt'].pos.kind === 'air' && guard++ < 60) c.step();
    expect(c.truth.formations['flt'].pos.kind).toBe('ground'); // came home and landed
    const events = c.store.all().map(l => l.event);
    expect(events.some(e => e.type === 'FUEL_THRESHOLD' && e.threshold === 'JOKER')).toBe(true);
    expect(events.some(e => e.type === 'FUEL_THRESHOLD' && e.threshold === 'BINGO')).toBe(true);
    expect(events.some(e => e.type === 'AIR_LANDED')).toBe(true);
  });

  it('a timed station (loiterTicks) flies the plot and comes home without bingo', () => {
    const truth = baseTruth('AIR-TIMED');
    withAirbase(truth);
    addFlight(truth, { id: 'flt', sideId: 'blue', basePos: gp(5, 5),
                       homeFacilityId: 'base', fp: 400 }).alertState = 'ALERT5';
    const c = Campaign.create(truth);
    c.inject({ type: 'ORDER_ISSUED', order: airOrder('o', 'flt', 'RECON',
      { station: station(7, 5), loiterTicks: 2, issuedTick: 0 }) }); // 2 hexes off the base
    let guard = 0;
    while (c.truth.formations['flt'].pos.kind === 'air' || guard === 0) {
      c.step();
      if (guard++ > 40) break;
    }
    const f = c.truth.formations['flt'];
    expect(f.pos.kind).toBe('ground');
    // 400 − TO 4 − climb 12 − out 2 − loiter 2CT×12 − back 2 − land 2 = 354
    expect(minFp(c.truth, f)).toBe(354);
    expect(c.truth.orders['o'].completed).toBe(true);
  });
});

describe('M3 — air detection & SIG', () => {
  it('air SIG: single 9, pair 8, flight 6; dash −2; lean +1', () => {
    const truth = baseTruth();
    const single = addFlight(truth, { id: 's1', sideId: 'red', airPos: { q: 0, r: 0 } });
    expect(computeAirSig(truth, single, false, false).tn).toBe(9);

    const pair = addFlight(truth, { id: 's2', sideId: 'red', count: 2, airPos: { q: 1, r: 0 } });
    expect(computeAirSig(truth, pair, false, false).tn).toBe(8);

    const flight = addFlight(truth, { id: 's3', sideId: 'red', count: 4, airPos: { q: 2, r: 0 } });
    expect(computeAirSig(truth, flight, false, false).tn).toBe(6);

    single.air = { ...single.air!, phase: 'ENROUTE', speed: 'DASH' };
    expect(computeAirSig(truth, single, false, false).tn).toBe(7); // dash burn −2

    pair.air = { ...pair.air!, phase: 'ON_STATION', lean: true };
    expect(computeAirSig(truth, pair, false, false).tn).toBe(9);   // lean loiter +1
  });

  it('radar horizon (D-037): stations reach 24 air hexes, plain ground 12, beyond is quiet', () => {
    const truth = baseTruth('AIR-EW');
    truth.facilities['st'] = mkFacility({
      id: 'st', sideId: 'blue', name: 'EW Station', pos: gp(5, 5),
      tags: ['SENSOR_STATION'], sensorStation: { passive: 6, active: 12 },
      activeSweep: true,
    });
    // congruent sky: the station searches from over its own hex (5,5); 20 hexes out is
    // inside its 24-hex horizon
    const bandit = addFlight(truth, { id: 'bandit', sideId: 'red', count: 4,
                                      airPos: { q: 25, r: 5 } });
    bandit.sigBase = 6;
    const c = Campaign.create(truth);
    c.step();
    expect(c.store.all().some(l => l.event.type === 'DIE_ROLLED' &&
      (l.event as any).roll.purpose.includes('EW Station'))).toBe(true);

    // 30 air hexes out: over the horizon, no roll
    const truth2 = baseTruth('AIR-EW2');
    truth2.facilities['st'] = truth.facilities['st'];
    addFlight(truth2, { id: 'bandit', sideId: 'red', count: 4, airPos: { q: 35, r: 5 } });
    const c2 = Campaign.create(truth2);
    c2.step();
    expect(c2.store.all().some(l => l.event.type === 'DIE_ROLLED' &&
      (l.event as any).roll.purpose.includes('air detection'))).toBe(false);

    // a plain ground formation reaches 12 — half the station's line
    const truth3 = baseTruth('AIR-EW3');
    addMechFormation(truth3, { id: 'watchers', sideId: 'blue', pos: gp(5, 5) });
    addFlight(truth3, { id: 'near', sideId: 'red', count: 4, airPos: { q: 15, r: 5 } })
      .sigBase = 6;                                             // 10 out: seen
    addFlight(truth3, { id: 'far', sideId: 'red', count: 4, airPos: { q: 25, r: 5 } });
    const c3 = Campaign.create(truth3);
    c3.step();
    const rolls = c3.store.all().filter(l => l.event.type === 'DIE_ROLLED' &&
      (l.event as any).roll.purpose.includes('air detection'))
      .map(l => (l.event as any).roll.purpose);
    expect(rolls.some((p: string) => p.includes('near'))).toBe(true);
    expect(rolls.some((p: string) => p.includes('far'))).toBe(false);
  });
});

describe('M3 — turnaround & the fuel farm', () => {
  function landedFixture(seed: string, farmTons = 20) {
    const truth = baseTruth(seed);
    withAirbase(truth, 5, 5, farmTons);
    const f = addFlight(truth, { id: 'flt', sideId: 'blue', basePos: gp(5, 5),
                                 homeFacilityId: 'base', fp: 159, tons: 5 });
    return Campaign.create(truth);
  }

  it('standard turnaround: refuels to full from the farm, crew busy 2 pulses', () => {
    const c = landedFixture('TURN-STD');
    const r = c.turnaround('flt', 'STANDARD');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readyTick).toBe(c.truth.tick + 2 * CLOCK.TICKS_PER_PULSE);
    expect(r.tonsDrawn).toBeCloseTo((400 - 159) / 80);
    expect(minFp(c.truth, c.truth.formations['flt'])).toBe(400);
    expect(c.truth.facilities['base'].fuelFarmTons).toBeCloseTo(20 - 3.0125);
    // crews are a finite resource
    expect(c.truth.facilities['base'].turnaroundCrews.busyUntil).toHaveLength(1);
  });

  it('an empty farm refuses the turnaround', () => {
    const c = landedFixture('TURN-DRY', 0.5);
    const r = c.turnaround('flt', 'STANDARD');
    expect(r.ok).toBe(false);
  });

  it('hot-pit rolls 2d6 and a 2–3 burns 1d6×10 FP of farm stock (seeded mishap)', () => {
    // hunt a seed whose first 2d6 is ≤3 to exercise the mishap branch deterministically
    let c = landedFixture('TURN-HOT-0');
    for (let i = 1; i < 200; i++) {
      const probe = landedFixture(`TURN-HOT-${i}`);
      if (rollDice(`TURN-HOT-${i}`, probe.truth.seedCursor, '2d6').result <= 3) {
        c = probe; break;
      }
    }
    const farmBefore = c.truth.facilities['base'].fuelFarmTons;
    const r = c.turnaround('flt', 'HOT_PIT');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.mishap) {
      // farm paid the refuel AND the fire; flight stands down an extra pulse
      expect(c.truth.facilities['base'].fuelFarmTons).toBeLessThan(farmBefore - r.tonsDrawn + 1e-9);
      expect(r.readyTick).toBe(c.truth.tick + 2 * CLOCK.TICKS_PER_PULSE);
    } else {
      expect(r.readyTick).toBe(c.truth.tick + 1 * CLOCK.TICKS_PER_PULSE);
    }
  });
});
