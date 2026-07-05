/**
 * Air recon (ext, D-051): a flight on a RECON order photographs the corridor it
 * flies — terrain becomes scouted ground, enemy formations under the track get
 * passive-channel detection rolls, and the photos ride home with the plane.
 */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { reconSweep } from '../../src/engine/air.js';
import { deliverReportsPass } from '../../src/engine/net.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { SENSOR_RANGES } from '../../src/rules.js';
import { hexLine } from '../../src/hex/axial.js';
import { addFlight, addMechFormation, baseTruth, gp, mkFacility } from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

const HALF = Math.floor(SENSOR_RANGES.RECON_AIR_CORRIDOR_WIDTH / 2);

function run(truth: TruthState, fn: (emit: (e: GameEvent) => void) => void): GameEvent[] {
  const events: GameEvent[] = [];
  fn(e => { events.push(e); applyEvent(truth, e); });
  return events;
}

describe('the recon corridor (D-051)', () => {
  it('covers the spec width: a target 2 off the track is on the film, 3 off is not', () => {
    const truth = baseTruth('ARC-1', [], 30, 20);
    const flt = addFlight(truth, { id: 'photo', sideId: 'blue', airPos: { q: 5, r: 10 } });
    addMechFormation(truth, { id: 'near', sideId: 'red', pos: gp(10, 12) }); // 2 off
    addMechFormation(truth, { id: 'far', sideId: 'red', pos: gp(10, 13) }); // 3 off
    const events = run(truth, emit =>
      reconSweep(truth, emit, flt, hexLine({ q: 5, r: 10 }, { q: 15, r: 10 })));

    const rolls = events.filter(e => e.type === 'DIE_ROLLED')
      .map(e => (e as any).roll.purpose);
    expect(rolls.some((p: string) => /air recon photo → near/.test(p))).toBe(true);
    expect(rolls.some((p: string) => /far/.test(p))).toBe(false);

    // terrain: the corridor is scouted, the hex one past it is not
    const scouted = new Set(truth.scoutedHexes['blue'] ?? []);
    expect(scouted.has(`theater-1:10,${10 + HALF}`)).toBe(true);
    expect(scouted.has(`theater-1:10,${10 + HALF + 1}`)).toBe(false);
  });

  it('a hit climbs the ladder — and the photos wait for the plane to come home', () => {
    const truth = baseTruth('SALV-A', [], 30, 20); // seed rolls 10 on the first 2d6
    const flt = addFlight(truth, { id: 'photo', sideId: 'blue', airPos: { q: 10, r: 10 } });
    addMechFormation(truth, { id: 'column', sideId: 'red', pos: gp(10, 10) });
    run(truth, emit => reconSweep(truth, emit, flt, [{ q: 10, r: 10 }]));

    // TN 9 (lance 7 + night 2), rolled 10: GHOST — but the flight is airborne,
    // off-net by construction, so the report queues instead of delivering
    expect(truth.contacts['contact:blue:column']?.level).toBe(1);
    const reports = Object.values(truth.reports)
      .filter(r => r.sourceFormationId === 'photo');
    expect(reports).toHaveLength(1);
    expect(reports[0].deliveredTick).toBeNull();

    // the plane lands inside the net: the film gets developed
    flt.onNet = true; // netPass would set this on touchdown near a command node
    run(truth, emit => deliverReportsPass(truth, emit));
    expect(Object.values(truth.reports)
      .filter(r => r.sourceFormationId === 'photo')[0].deliveredTick).not.toBeNull();
  });

  it('flies the whole sortie through the step loop: launch, sweep, RTB, deliver', () => {
    const truth = baseTruth('ARC-3', [], 40, 20);
    truth.sides['blue'].commandNodes = ['base'];
    truth.facilities['base'] = mkFacility({
      id: 'base', sideId: 'blue', name: 'Photo Strip', pos: gp(2, 10),
      tags: ['AIRSTRIP'], fuelFarmTons: 10, isCommandNode: true,
      turnaroundCrews: { total: 1, busyUntil: [] },
    });
    addFlight(truth, { id: 'photo', sideId: 'blue', basePos: gp(2, 10),
      homeFacilityId: 'base', fp: 800, safeThrust: 4 }).alertState = 'ALERT5';
    // a battalion sitting in the open under the route: TN 7 at night — easy film
    addMechFormation(truth, { id: 'column', sideId: 'red', pos: gp(8, 10) }, 4)
      .sigBase = 5;

    const c = Campaign.create(truth);
    c.inject({ type: 'ORDER_ISSUED', order: {
      id: 'o', sideId: 'blue', formationId: 'photo', issuedTick: 0, effectiveTick: 0,
      kind: 'RECON', conditionals: [],
      path: [{ kind: 'air', gridQ: 12, gridR: 10, band: 'HIGH', altLevel: 6,
               velocity: 0, vectorDeg: 0 }] } as Order });
    let launched = false;
    for (let i = 0; i < 30; i++) {
      c.step('CONTACT');
      const ph = c.truth.formations['photo'].air?.phase;
      if (ph !== 'GROUNDED') launched = true;
      else if (launched) break; // flew the sortie and came home
    }

    const log = c.store.all();
    expect(c.truth.formations['photo'].air?.phase).toBe('GROUNDED'); // made it home
    expect(log.some(l => l.event.type === 'DIE_ROLLED' &&
      /air recon photo → column/.test((l.event as any).roll.purpose))).toBe(true);
    // the corridor over the column is scouted terrain now
    expect((c.truth.scoutedHexes['blue'] ?? [])).toContain('theater-1:8,10');
    // the sortie produced a contact and the report was delivered after touchdown
    expect(c.truth.contacts['contact:blue:column']).toBeDefined();
    const delivered = Object.values(c.truth.reports).filter(r =>
      r.sourceFormationId === 'photo' && r.deliveredTick !== null);
    expect(delivered.length).toBeGreaterThan(0);
    expect(replay(log)).toEqual(c.truth);
  });

  it('a CAP flight is not a camera: no recon sweep without the RECON order', () => {
    const truth = baseTruth('ARC-4', [], 40, 20);
    truth.facilities['base'] = mkFacility({
      id: 'base', sideId: 'blue', name: 'Strip', pos: gp(2, 10),
      tags: ['AIRSTRIP'], fuelFarmTons: 10, turnaroundCrews: { total: 1, busyUntil: [] },
    });
    addFlight(truth, { id: 'cap', sideId: 'blue', basePos: gp(2, 10),
      homeFacilityId: 'base', fp: 800, safeThrust: 4 }).alertState = 'ALERT5';
    addMechFormation(truth, { id: 'column', sideId: 'red', pos: gp(8, 10) }, 4);

    const c = Campaign.create(truth);
    c.inject({ type: 'ORDER_ISSUED', order: {
      id: 'o', sideId: 'blue', formationId: 'cap', issuedTick: 0, effectiveTick: 0,
      kind: 'CAP', conditionals: [],
      station: { kind: 'air', gridQ: 12, gridR: 10, band: 'HIGH', altLevel: 6,
                 velocity: 0, vectorDeg: 0 }, loiterTicks: 4 } as Order });
    for (let i = 0; i < 10; i++) c.step('CONTACT');
    expect(c.store.all().some(l => l.event.type === 'DIE_ROLLED' &&
      /air recon/.test((l.event as any).roll.purpose))).toBe(false);
  });
});
