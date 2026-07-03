/**
 * The congruent sky (ext, D-037): every ground hex has an air hex above it, so position
 * in the sky is real — launches climb over their own base, raids cross the map in real
 * time, radar coverage is geography, and RTB distance is distance.
 */
import { describe, expect, it } from 'vitest';
import { Campaign } from '../../src/core/truth.js';
import { airHexOver, groundHexUnder, predictAirPos, rtbDistance } from '../../src/engine/air.js';
import { addFlight, baseTruth, gp, mkFacility } from '../helpers.js';
import type { Order } from '../../src/core/types.js';

function airOrder(id: string, formationId: string, kind: Order['kind'],
                  extra: Partial<Order> = {}): Order {
  return { id, sideId: 'blue', formationId, issuedTick: 0, effectiveTick: 0,
           kind, conditionals: [], ...extra };
}

describe('the congruent sky (D-037)', () => {
  it('airHexOver / groundHexUnder are inverses across theater origins', () => {
    const truth = baseTruth('SKY-1', [], 30, 20);
    truth.config.airHexByTheater = { 'theater-1': { q: 100, r: 50 } };
    const over = airHexOver(truth, gp(7, 9));
    expect(over).toEqual({ q: 107, r: 59 });
    expect(groundHexUnder(truth, over)).toEqual(gp(7, 9));
    expect(groundHexUnder(truth, { q: 500, r: 500 })).toBeNull(); // open sky
  });

  it('a launch climbs into the sky over its own base — not some theater-wide hex', () => {
    const truth = baseTruth('SKY-2', [], 30, 20);
    truth.facilities['base'] = mkFacility({
      id: 'base', sideId: 'blue', name: 'Fwd Strip', pos: gp(22, 11),
      tags: ['AIRSTRIP'], fuelFarmTons: 10, turnaroundCrews: { total: 1, busyUntil: [] },
    });
    addFlight(truth, { id: 'flt', sideId: 'blue', basePos: gp(22, 11),
      homeFacilityId: 'base', fp: 400 }).alertState = 'ALERT5';
    const c = Campaign.create(truth);
    c.inject({ type: 'ORDER_ISSUED', order: airOrder('o', 'flt', 'CAP', {
      station: { kind: 'air', gridQ: 22, gridR: 11, band: 'HIGH', altLevel: 6,
                 velocity: 0, vectorDeg: 0 } }) });
    c.step('CONTACT');
    const pos = c.truth.formations['flt'].pos;
    expect(pos.kind).toBe('air');
    if (pos.kind === 'air') expect({ q: pos.gridQ, r: pos.gridR }).toEqual({ q: 22, r: 11 });
  });

  it('a raid crosses the map in real time and RTB distance is real geography', () => {
    const truth = baseTruth('SKY-3', [], 40, 20);
    truth.facilities['base'] = mkFacility({
      id: 'base', sideId: 'blue', name: 'Rear Strip', pos: gp(0, 10),
      tags: ['AIRSTRIP'], fuelFarmTons: 10, turnaroundCrews: { total: 1, busyUntil: [] },
    });
    const flt = addFlight(truth, { id: 'flt', sideId: 'blue', basePos: gp(0, 10),
      homeFacilityId: 'base', fp: 800, safeThrust: 4 }); // D-038: cruise 2 hexes/turn
    flt.alertState = 'ALERT5';
    const c = Campaign.create(truth);
    // strike station over a target 6 hexes across the map: 3 full turns of transit
    c.inject({ type: 'ORDER_ISSUED', order: airOrder('o', 'flt', 'STRIKE_AIR', {
      station: { kind: 'air', gridQ: 6, gridR: 10, band: 'HIGH', altLevel: 6,
                 velocity: 0, vectorDeg: 0 }, loiterTicks: 1 }) });
    c.step('CONTACT'); // airborne over the base
    const legs: number[] = [];
    for (let i = 0; i < 4 && c.truth.formations['flt'].air?.phase !== 'ON_STATION'; i++) {
      c.step('CONTACT');
      const p = c.truth.formations['flt'].pos;
      if (p.kind === 'air') legs.push(p.gridQ);
    }
    expect(legs).toEqual([2, 4, 6]); // hex by hex across the sky, three turns of exposure
    // and home is 6 hexes of fuel away — range is geography now
    expect(rtbDistance(c.truth, c.truth.formations['flt'])).toBe(6);
  });

  it('the lead is only as good as the track (D-038): LOCK plots clean, SHADOW drifts', () => {
    const truth = baseTruth('LEAD-1', [], 40, 20);
    const bandit = addFlight(truth, { id: 'bandit', sideId: 'red',
      airPos: { q: 10, r: 10 }, fp: 4000, safeThrust: 4 });
    bandit.air = { phase: 'ENROUTE', speed: 'CRUISE' };
    truth.orders['run'] = { id: 'run', sideId: 'red', formationId: 'bandit',
      issuedTick: 0, effectiveTick: 0, kind: 'FERRY', airSpeed: 'CRUISE', conditionals: [],
      path: [{ kind: 'air', gridQ: 200, gridR: 10, band: 'HIGH', altLevel: 6,
               velocity: 0, vectorDeg: 0 }] };
    bandit.currentOrderId = 'run';

    let drifted = 0;
    for (let tick = 0; tick < 24; tick++) {
      truth.tick = tick;
      const clean = predictAirPos(truth, bandit, 1, 4)!;   // LOCK
      expect(clean).toEqual({ q: 12, r: 10 });             // exact plot: cur + cruise 2
      const shadow = predictAirPos(truth, bandit, 1, 2)!;  // SHADOW: ±2 drift
      expect(predictAirPos(truth, bandit, 1, 2)).toEqual(shadow); // deterministic (replay)
      expect(Math.abs(shadow.q - clean.q) + Math.abs(shadow.r - clean.r)).toBeLessThanOrEqual(4);
      if (shadow.q !== clean.q || shadow.r !== clean.r) drifted++;
    }
    expect(drifted).toBeGreaterThan(0);   // a SHADOW-grade lead misses sometimes
    expect(drifted).toBeLessThan(24);     // ...but not always — it's a smear, not a wall
    // a parked target needs no lead and takes no error, whatever the track
    bandit.air = { phase: 'ON_STATION', speed: 'CRUISE' };
    expect(predictAirPos(truth, bandit, 1, 2)).toEqual({ q: 10, r: 10 });
  });

  it('an EW picket line gives warning time; a raid outside it crosses dark', () => {
    const truth = baseTruth('SKY-4', [], 40, 20);
    truth.facilities['ew'] = mkFacility({
      id: 'ew', sideId: 'blue', name: 'Border Radar', pos: gp(30, 10),
      tags: ['SENSOR_STATION'], sensorStation: { passive: 6, active: 12 },
      activeSweep: true,
    });
    // a raid inside the picket's 24-hex horizon draws detection rolls...
    addFlight(truth, { id: 'raid', sideId: 'red', count: 4, airPos: { q: 12, r: 10 } })
      .sigBase = 6;
    const c = Campaign.create(truth);
    c.step();
    expect(c.store.all().some(l => l.event.type === 'DIE_ROLLED' &&
      (l.event as any).roll.purpose.includes('Border Radar'))).toBe(true);

    // ...while the same raid routed through the far corner stays off the scope
    const truth2 = baseTruth('SKY-5', [], 40, 20);
    truth2.facilities['ew'] = truth.facilities['ew'];
    addFlight(truth2, { id: 'raid', sideId: 'red', count: 4, airPos: { q: 2, r: 0 } });
    const c2 = Campaign.create(truth2);
    c2.step();
    expect(c2.store.all().some(l => l.event.type === 'DIE_ROLLED' &&
      (l.event as any).roll.purpose.includes('air detection'))).toBe(false);
  });
});
