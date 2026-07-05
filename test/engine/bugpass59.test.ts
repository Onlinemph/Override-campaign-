/**
 * D-059 — the movement/sensors/hex-reveal/net bug pass. Each test pins one fix:
 * regressions here mean a live-play symptom is back.
 */
import { describe, expect, it } from 'vitest';
import { Campaign } from '../../src/core/truth.js';
import { step } from '../../src/engine/tick.js';
import { movementPass } from '../../src/engine/movement.js';
import { detectionPass } from '../../src/engine/detection.js';
import { netPass, scoutPass } from '../../src/engine/net.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { NET, SKYWATCH } from '../../src/rules.js';
import { addFlight, addMechFormation, baseTruth, gp, mkFacility, mkUnit, moveOrder, T }
  from '../helpers.js';
import type { GroundPos, Order, TruthState } from '../../src/core/types.js';

function run(truth: TruthState, fn: (emit: (e: GameEvent) => void) => void): GameEvent[] {
  const events: GameEvent[] = [];
  fn(e => { events.push(e); applyEvent(truth, e); });
  return events;
}

const order = (id: string, f: { id: string; sideId: string }, kind: Order['kind'],
               extra: Partial<Order> = {}): Order => ({
  id, sideId: f.sideId, formationId: f.id, issuedTick: 0, effectiveTick: 1,
  kind, conditionals: [], ...extra,
});

describe('D-059 — stale orders must not resurrect', () => {
  it('the loser of a same-step order race is cancelled, not parked', () => {
    const truth = baseTruth('D59-RACE', [], 40, 20);
    const f = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 5), omp: 6 });
    f.onNet = true;
    const c = Campaign.create(truth);
    // plotted east... no wait, CORRECTED to a short hop south — both due together
    c.inject({ type: 'ORDER_ISSUED', order: order('old', f, 'MOVE', {
      path: [gp(25, 5)], issuedTick: 0 }) });
    c.inject({ type: 'ORDER_ISSUED', order: order('new', f, 'MOVE', {
      path: [gp(5, 8)], issuedTick: 1 }) });
    for (let i = 0; i < 20 && !c.truth.orders['new'].completed; i++) c.step('CONTACT');
    expect(c.truth.orders['new'].completed).toBe(true);
    expect(c.truth.orders['old'].completed).toBe(true); // cancelled, not lurking
    const arrived = { ...c.truth.formations['m1'].pos } as GroundPos;
    expect({ q: arrived.q, r: arrived.r }).toEqual({ q: 5, r: 8 });
    // and the corrected-away-from order never reactivates
    for (let i = 0; i < 10; i++) c.step('CONTACT');
    expect(c.truth.formations['m1'].pos).toEqual(arrived);
  });
});

describe('D-059 — PATROL walks its loop', () => {
  it('moves along the plotted circuit and loops back to the first hex', () => {
    const truth = baseTruth('D59-PATROL', [], 30, 20);
    truth.clockMode = 'CONTACT';
    const f = addMechFormation(truth, { id: 'p1', sideId: 'blue', pos: gp(5, 5), omp: 20 });
    truth.orders['o1'] = { ...moveOrder('o1', f, 'PATROL', [gp(7, 5), gp(5, 5)]), issuedTick: 0 };
    f.currentOrderId = 'o1';
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      run(truth, emit => movementPass(truth, 1, emit));
      const p = truth.formations['p1'].pos as GroundPos;
      seen.add(`${p.q},${p.r}`);
    }
    expect(truth.orders['o1'].completed).toBeUndefined(); // standing order
    expect(seen.has('7,5')).toBe(true);  // reached the far end
    expect(seen.size).toBeGreaterThan(1); // and it MOVES (used to stand still forever)
  });
});

describe('D-059 — the map reveals what the sensors see', () => {
  it('scoutPass sweeps the hexes a fast column moved THROUGH, not just the endpoint', () => {
    const truth = baseTruth('D59-SWEEP', [], 40, 20);
    truth.clockMode = 'PULSE';
    const f = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 10), omp: 8 });
    f.onNet = true;
    truth.orders['o1'] = { ...moveOrder('o1', f, 'MOVE', [gp(30, 10)]), issuedTick: 0,
                           effectiveTick: 0 };
    f.currentOrderId = 'o1';
    const r = step(truth, 'PULSE'); // 8 hexes in one pulse step
    const scouted = new Set(r.truth.scoutedHexes['blue'] ?? []);
    const p = r.truth.formations['m1'].pos as GroundPos;
    expect(p.q).toBeGreaterThanOrEqual(12);
    // every hex along the path is lit — including the middle of the stride
    for (let q = 5; q <= p.q; q++) expect(scouted.has(`${T}:${q},10`)).toBe(true);
  });

  it('scouting radius uses the DERIVED sensor suite (Mobile HQ = 4), like the map ring', () => {
    const truth = baseTruth('D59-SNS', [], 30, 20);
    const f = addMechFormation(truth, { id: 'hq', sideId: 'blue', pos: gp(10, 10) }, 1,
      { tags: ['HQ'] });
    run(truth, emit => scoutPass(truth, emit));
    const scouted = new Set(truth.scoutedHexes['blue'] ?? []);
    expect(scouted.has(`${T}:14,10`)).toBe(true);  // radius 4 (MOBILE_HQ), not 2
    expect(scouted.has(`${T}:15,10`)).toBe(false);
  });

  it('a sensor station reveals the terrain its coverage ring is drawn over', () => {
    const truth = baseTruth('D59-STATION', [], 30, 20);
    truth.facilities['eyes'] = mkFacility({ id: 'eyes', sideId: 'blue', name: 'Watch Hill',
      pos: gp(10, 10), tags: ['SENSOR_STATION'],
      sensorStation: { passive: 6, active: 12 } });
    run(truth, emit => scoutPass(truth, emit));
    const scouted = new Set(truth.scoutedHexes['blue'] ?? []);
    expect(scouted.has(`${T}:16,10`)).toBe(true);  // radius 6
    expect(scouted.has(`${T}:17,10`)).toBe(false);
  });
});

describe('D-059 — proximity detection', () => {
  it('adjacent searchers roll with the point-blank bonus', () => {
    const truth = baseTruth('D59-PROX', [], 30, 20);
    addMechFormation(truth, { id: 'scout', sideId: 'blue', pos: gp(10, 10) });
    addMechFormation(truth, { id: 'quiet', sideId: 'red', pos: gp(11, 10), sigBase: 12 });
    const events = run(truth, emit => detectionPass(truth, emit));
    const roll = events.find(e => e.type === 'DIE_ROLLED' &&
      /scout .*→ .*quiet/.test((e as any).roll.purpose)) as any;
    expect(roll).toBeDefined();
    expect(roll.roll.purpose).toContain('+2'); // POINT_BLANK is in the roll
  });
});

describe('D-059 — the film outlives the faded track', () => {
  it('a report delivered after CONTACT_REMOVED recreates the delivered picture', () => {
    const truth = baseTruth('D59-FILM', [], 30, 20);
    truth.reports['report:1:contact:blue:ghost:src:0'] = {
      id: 'report:1:contact:blue:ghost:src:0', sideId: 'blue', generatedTick: 1,
      deliveredTick: null, sourceFormationId: 'src', contactId: 'contact:blue:ghost',
      text: 'T+1 — courier: SHADOW', snapshot: {
        level: 2, estPos: gp(9, 9), posErrorHexes: 0, estSizeClass: 'lance', asOfTick: 1 },
    };
    // the live track faded to nothing before the courier landed
    expect(truth.contacts['contact:blue:ghost']).toBeUndefined();
    run(truth, emit => emit({ type: 'REPORT_DELIVERED',
      reportId: 'report:1:contact:blue:ghost:src:0', tick: 30 }));
    const c = truth.contacts['contact:blue:ghost'];
    expect(c).toBeDefined();
    expect(c.level).toBe(0);                      // cold — fadePass ignores it
    expect(c.targetFormationId).toBe('ghost');
    expect(c.delivered?.level).toBe(2);           // but the side HAS the picture
    expect(c.delivered?.estPos).toEqual(gp(9, 9));
  });
});

describe('D-059 — air fixes', () => {
  it('a dense hand-drawn route flies at full speed (multi-leg per step)', () => {
    const truth = baseTruth('D59-LEGS', [], 40, 20);
    const flt = addFlight(truth, { id: 'fast', sideId: 'blue', airPos: { q: 5, r: 10 },
      safeThrust: 6 });
    flt.onNet = true;
    // waypoints every single hex — the old code flew ONE of these per step
    const path = Array.from({ length: 12 }, (_, i) => ({
      kind: 'air' as const, gridQ: 6 + i, gridR: 10, band: 'HIGH' as const,
      altLevel: 6, velocity: 0, vectorDeg: 0 }));
    truth.orders['o1'] = { id: 'o1', sideId: 'blue', formationId: 'fast',
      issuedTick: 0, effectiveTick: 0, kind: 'FERRY', conditionals: [], path };
    flt.currentOrderId = 'o1';
    const r = step(truth, 'CONTACT'); // cruise = safeThrust/2 = 3 air hexes per turn
    const p = r.truth.formations['fast'].pos;
    expect(p.kind === 'air' ? p.gridQ : (p as GroundPos).q).toBeGreaterThanOrEqual(8);
  });

  it('FERRY puts down at its destination and rebases to a strip there', () => {
    const truth = baseTruth('D59-FERRY', [], 40, 20);
    truth.facilities['fwd'] = mkFacility({ id: 'fwd', sideId: 'blue', name: 'Forward Strip',
      pos: gp(12, 10), tags: ['AIRSTRIP'], fuelFarmTons: 5 });
    const flt = addFlight(truth, { id: 'wing', sideId: 'blue', airPos: { q: 10, r: 10 },
      safeThrust: 6, fp: 900 });
    truth.orders['o1'] = { id: 'o1', sideId: 'blue', formationId: 'wing',
      issuedTick: 0, effectiveTick: 0, kind: 'FERRY', conditionals: [],
      path: [{ kind: 'air', gridQ: 12, gridR: 10, band: 'HIGH', altLevel: 6,
               velocity: 0, vectorDeg: 0 }] };
    flt.currentOrderId = 'o1';
    let t = truth;
    for (let i = 0; i < 6 && t.formations['wing'].pos.kind !== 'ground'; i++) {
      t = step(t, 'CONTACT').truth;
    }
    const p = t.formations['wing'].pos as GroundPos;
    expect(p.kind).toBe('ground');
    expect({ q: p.q, r: p.r }).toEqual({ q: 12, r: 10 }); // AT the destination, not home
    expect(t.formations['wing'].air?.homeFacilityId).toBe('fwd'); // rebased
  });

  it('a cancelled mission clears its prep clock instead of pinning CONTACT mode', () => {
    const truth = baseTruth('D59-CLOCK', [], 30, 20);
    truth.facilities['base'] = mkFacility({ id: 'base', sideId: 'blue', name: 'Strip',
      pos: gp(5, 10), tags: ['AIRSTRIP'], fuelFarmTons: 10 });
    const flt = addFlight(truth, { id: 'alert', sideId: 'blue', basePos: gp(5, 10),
      homeFacilityId: 'base' });
    flt.air = { ...flt.air!, launchAtTick: 15 }; // mid-prep leftovers, order GONE
    const r = step(truth, 'CONTACT');
    expect(r.truth.formations['alert'].air?.launchAtTick ?? null).toBeNull();
  });
});

describe('D-059 — command net fixes', () => {
  it('a DESTROYED facility node costs the re-net blackout, like a dead mobile HQ', () => {
    const truth = baseTruth('D59-DEADHQ', [], 40, 20);
    truth.sides['blue'].commandNodes = ['hq1', 'hq2'];
    truth.facilities['hq1'] = mkFacility({ id: 'hq1', sideId: 'blue', name: 'Fwd HQ',
      pos: gp(10, 10), isCommandNode: true });
    truth.facilities['hq2'] = mkFacility({ id: 'hq2', sideId: 'blue', name: 'Rear HQ',
      pos: gp(14, 10), isCommandNode: true });
    const f = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(10, 11) });
    run(truth, emit => netPass(truth, emit));
    expect(truth.formations['m1'].onNet).toBe(true);
    expect(truth.formations['m1'].netNodeId).toBe('hq1');
    run(truth, emit => {
      emit({ type: 'FACILITY_DAMAGED', facilityId: 'hq1', damage: 'DESTROYED', tick: 0 });
      netPass(truth, emit);
    });
    expect(truth.formations['m1'].onNet).toBe(false);          // blackout, not instant re-home
    expect(truth.formations['m1'].renetAtTick).not.toBeNull(); // 1-pulse re-net running
  });

  it('relays honor the campaign netGroundRadius override', () => {
    const truth = baseTruth('D59-RELAY', [], 60, 20);
    truth.config.netGroundRadius = 18;
    truth.sides['blue'].commandNodes = ['hq'];
    const hq = addMechFormation(truth, { id: 'hq', sideId: 'blue', pos: gp(5, 10) }, 1,
      { tags: ['HQ'] });
    hq.onNet = true;
    // relay chained at link range, formation 15 hexes past the relay: inside 18, outside 12
    truth.facilities['mast'] = mkFacility({ id: 'mast', sideId: 'blue', name: 'Mast',
      pos: gp(5 + NET.RELAY_LINK_HEXES, 10), tags: ['COMM_RELAY'] });
    const far = addMechFormation(truth, { id: 'far', sideId: 'blue',
      pos: gp(5 + NET.RELAY_LINK_HEXES + 15, 10) });
    run(truth, emit => netPass(truth, emit));
    expect(truth.formations['far'].onNet).toBe(true);
  });
});
