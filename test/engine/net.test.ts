/** B8 — command nets & report delivery (core §4.2; spec §3.3). */
import { describe, expect, it } from 'vitest';
import { deliverReportsPass, isFormationOnNet, netPass } from '../../src/engine/net.js';
import { computeDetectionTN } from '../../src/engine/detection.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { mkFacility } from '../../src/fixtures.js';
import { addMechFormation, baseTruth, gp } from '../helpers.js';
import type { ContactReport, TruthState } from '../../src/core/types.js';

function runNet(truth: TruthState): GameEvent[] {
  const events: GameEvent[] = [];
  const emit = (e: GameEvent) => { events.push(e); applyEvent(truth, e); };
  netPass(truth, emit);
  return events;
}

function withHq(truth: TruthState, q = 0, r = 0, id = 'hq') {
  const hq = addMechFormation(truth, { id, sideId: 'blue', pos: gp(q, r) });
  truth.sides['blue'].commandNodes.push(hq.id);
  return hq;
}

function mkReport(id: string, source: string, generatedTick = 5): ContactReport {
  return {
    id, sideId: 'blue', generatedTick, deliveredTick: null,
    sourceFormationId: source, contactId: 'c-x', text: 'test report',
    snapshot: { level: 1, estPos: gp(9, 9), posErrorHexes: 1, asOfTick: generatedTick },
  };
}

describe('B8 — command nets', () => {
  it('within 12 hexes of a friendly command node ⇒ on-net (immediate first assignment)', () => {
    const truth = baseTruth();
    withHq(truth);
    const f = addMechFormation(truth, { id: 'f1', sideId: 'blue', pos: gp(12, 0) });
    runNet(truth);
    expect(truth.formations['f1'].onNet).toBe(true);
    expect(isFormationOnNet(truth, f)).toBe(true);
  });

  it('config.netGroundRadius overrides the default reach', () => {
    const truth = baseTruth();
    truth.config.netGroundRadius = 18;
    withHq(truth);
    const f = addMechFormation(truth, { id: 'f1', sideId: 'blue', pos: gp(15, 0) });
    runNet(truth);
    expect(truth.formations['f1'].onNet).toBe(true); // 15 ≤ 18, on-net only with the override
  });

  it('beyond 12 hexes ⇒ off-net; returning into radius of the SAME live node is instant', () => {
    const truth = baseTruth();
    withHq(truth);
    const f = addMechFormation(truth, { id: 'f1', sideId: 'blue', pos: gp(13, 0) });
    runNet(truth);
    expect(truth.formations['f1'].onNet).toBe(false);

    f.pos = gp(10, 0);
    runNet(truth);
    expect(truth.formations['f1'].onNet).toBe(true);

    f.pos = gp(20, 0);
    runNet(truth);
    expect(truth.formations['f1'].onNet).toBe(false);

    f.pos = gp(5, 0); // back to its own node: no re-net delay (D-008.2)
    runNet(truth);
    expect(truth.formations['f1'].onNet).toBe(true);
  });

  it('EMCON DARK means no transmissions: off-net even inside radius', () => {
    const truth = baseTruth();
    withHq(truth);
    const f = addMechFormation(truth, { id: 'f1', sideId: 'blue', pos: gp(3, 0), emcon: 'DARK' });
    runNet(truth);
    expect(truth.formations['f1'].onNet).toBe(false);
    expect(isFormationOnNet(truth, f)).toBe(false);
  });

  it('hostile ECM in the same hex cuts the net (D-008.1)', () => {
    const truth = baseTruth();
    withHq(truth);
    addMechFormation(truth, { id: 'f1', sideId: 'blue', pos: gp(5, 0) });
    runNet(truth);
    expect(truth.formations['f1'].onNet).toBe(true);

    addMechFormation(truth, { id: 'jammer', sideId: 'red', pos: gp(5, 0) }, 4, { tags: ['ECM'] });
    runNet(truth);
    expect(truth.formations['f1'].onNet).toBe(false);
  });

  it('decapitation: node destroyed ⇒ off-net; re-net to another node takes 1 pulse', () => {
    const truth = baseTruth();
    withHq(truth, 0, 0, 'hq1');
    withHq(truth, 6, 0, 'hq2');
    const f = addMechFormation(truth, { id: 'f1', sideId: 'blue', pos: gp(3, 0) });
    runNet(truth);
    expect(f.netNodeId).toBeTruthy();
    const firstNode = f.netNodeId!;
    const otherNode = firstNode === 'hq1' ? 'hq2' : 'hq1';

    truth.tick = 50;
    applyEvent(truth, { type: 'FORMATION_DESTROYED', formationId: firstNode,
                        reason: 'test', tick: 50 });
    runNet(truth);
    expect(truth.formations['f1'].onNet).toBe(false);
    expect(truth.formations['f1'].renetAtTick).toBe(60); // 1 pulse

    truth.tick = 55;
    runNet(truth);
    expect(truth.formations['f1'].onNet).toBe(false); // still re-establishing

    truth.tick = 60;
    runNet(truth);
    expect(truth.formations['f1'].onNet).toBe(true);
    expect(truth.formations['f1'].netNodeId).toBe(otherNode);
  });

  it('live comm satellite extends the net theater-wide (core §8.6)', () => {
    const truth = baseTruth();
    withHq(truth);
    const far = addMechFormation(truth, { id: 'far', sideId: 'blue', pos: gp(29, 19) });
    runNet(truth);
    expect(far.onNet).toBe(false);

    truth.satellites['comm'] = {
      id: 'comm', sideId: 'blue', kind: 'COMM', theaterId: 'theater-1',
      corridor: [], periodPulses: 4, nextPassTick: 0, alive: true, knownTo: ['blue'],
    };
    truth.sides['blue'].commandNodes.push('comm');
    runNet(truth);
    expect(truth.formations['far'].onNet).toBe(true);

    truth.satellites['comm'].alive = false; // satellites can be killed (core §8.6)
    runNet(truth);
    expect(truth.formations['far'].onNet).toBe(false);
  });
});

describe('D-048 — command relays: the net chains', () => {
  function wide(seed = 'NET-RELAY') { return baseTruth(seed, [], 60, 22); }

  it('an HQ truck within link range chains the net to formations beyond the node', () => {
    const truth = wide();
    withHq(truth); // node at 0,0 — radius 12
    addMechFormation(truth, { id: 'relay', sideId: 'blue', pos: gp(20, 0) }, 1, { tags: ['HQ'] });
    const far = addMechFormation(truth, { id: 'far', sideId: 'blue', pos: gp(30, 0) });
    runNet(truth);
    expect(truth.formations['relay'].onNet).toBe(true);  // chained: 20 ≤ link 24
    expect(truth.formations['far'].onNet).toBe(true);    // netted by the relay: 10 ≤ 12
    expect(truth.formations['far'].netNodeId).toBe('relay');
  });

  it('relays chain hop by hop — and killing a mid-chain relay drops everything downstream', () => {
    const truth = wide();
    withHq(truth);
    addMechFormation(truth, { id: 'r1', sideId: 'blue', pos: gp(20, 0) }, 1, { tags: ['HQ'] });
    addMechFormation(truth, { id: 'r2', sideId: 'blue', pos: gp(40, 0) }, 1, { tags: ['HQ'] });
    addMechFormation(truth, { id: 'far', sideId: 'blue', pos: gp(50, 0) });
    runNet(truth);
    expect(truth.formations['far'].onNet).toBe(true); // hq → r1 → r2 → far

    applyEvent(truth, { type: 'FORMATION_DESTROYED', formationId: 'r1',
                        reason: 'DF-ed and struck', tick: 0 });
    runNet(truth);
    expect(truth.formations['r2'].onNet).toBe(false); // 40 > link 24 from the node
    expect(truth.formations['far'].onNet).toBe(false); // the whole line went dark
  });

  it('a DARK or jammed relay drops out of the chain (radios have gates too)', () => {
    const truth = wide();
    withHq(truth);
    const relay = addMechFormation(truth, { id: 'relay', sideId: 'blue', pos: gp(20, 0) },
      1, { tags: ['HQ'] });
    addMechFormation(truth, { id: 'far', sideId: 'blue', pos: gp(30, 0) });
    runNet(truth);
    expect(truth.formations['far'].onNet).toBe(true);

    relay.emcon = 'DARK'; // radio off relays nothing
    runNet(truth);
    expect(truth.formations['far'].onNet).toBe(false);

    relay.emcon = 'PASSIVE';
    addMechFormation(truth, { id: 'jammer', sideId: 'red', pos: gp(20, 0) }, 1, { tags: ['ECM'] });
    runNet(truth); // a Raven parked on the relay cuts the line without firing a shot
    expect(truth.formations['far'].onNet).toBe(false);
  });

  it('a COMM_RELAY facility (a mast) chains like a truck', () => {
    const truth = wide();
    withHq(truth);
    truth.facilities['mast'] = mkFacility({ id: 'mast', sideId: 'blue', name: 'Relay Mast',
      pos: gp(20, 0), tags: ['COMM_RELAY'] });
    addMechFormation(truth, { id: 'far', sideId: 'blue', pos: gp(30, 0) });
    runNet(truth);
    expect(truth.formations['far'].onNet).toBe(true);
    expect(truth.formations['far'].netNodeId).toBe('mast');
  });

  it('a chained relay is a big radio: the "relaying" SIG penalty applies only while chained', () => {
    const truth = wide();
    withHq(truth);
    const relay = addMechFormation(truth, { id: 'relay', sideId: 'blue', pos: gp(20, 0) },
      1, { tags: ['HQ'] });
    const labels = () =>
      computeDetectionTN(truth, relay, 'PASSIVE_SENSOR', false).mods.map(m => m.label);
    expect(labels()).toContain('relaying');
    relay.pos = gp(40, 0); // out of link range: candidate, but not chained — quiet
    expect(labels()).not.toContain('relaying');
  });
});

describe('B8 — report delivery', () => {
  it('held while the source is off-net; delivered (with original timestamp) on return', () => {
    const truth = baseTruth();
    withHq(truth);
    addMechFormation(truth, { id: 'scout', sideId: 'blue', pos: gp(20, 0) });
    truth.reports['r1'] = mkReport('r1', 'scout', 5);
    runNet(truth);

    truth.tick = 30;
    const held: GameEvent[] = [];
    deliverReportsPass(truth, e => { held.push(e); applyEvent(truth, e); });
    expect(held).toHaveLength(0);
    expect(truth.reports['r1'].deliveredTick).toBeNull();

    truth.formations['scout'].pos = gp(8, 0);
    runNet(truth);
    truth.tick = 42;
    const delivered: GameEvent[] = [];
    deliverReportsPass(truth, e => { delivered.push(e); applyEvent(truth, e); });
    expect(truth.reports['r1'].deliveredTick).toBe(42);
    expect(truth.reports['r1'].generatedTick).toBe(5); // staleness preserved
  });

  it('killing the messenger deletes the undelivered report (core §6.5 counter-intel)', () => {
    const truth = baseTruth();
    withHq(truth);
    addMechFormation(truth, { id: 'scout', sideId: 'blue', pos: gp(20, 0) });
    truth.reports['r1'] = mkReport('r1', 'scout');
    applyEvent(truth, { type: 'FORMATION_DESTROYED', formationId: 'scout',
                        reason: 'ambushed', tick: 10 });

    const events: GameEvent[] = [];
    deliverReportsPass(truth, e => { events.push(e); applyEvent(truth, e); });
    expect(events.some(e => e.type === 'REPORTS_LOST')).toBe(true);
    expect(truth.reports['r1'].lost).toBe(true);
    expect(truth.reports['r1'].deliveredTick).toBeNull();
  });

  it('delivery merges the snapshot into the side`s received picture (D-008.5)', () => {
    const truth = baseTruth();
    withHq(truth);
    addMechFormation(truth, { id: 'scout', sideId: 'blue', pos: gp(5, 0) });
    truth.contacts['c-x'] = {
      id: 'c-x', observerSideId: 'blue', targetFormationId: 'enemy', kind: 'STANDARD',
      level: 1, lastConfirmedTick: 5, lastFadeTick: 5,
      estPos: gp(9, 9), posErrorHexes: 1, staleAsOfTick: 5,
    };
    truth.reports['r1'] = mkReport('r1', 'scout', 5);
    runNet(truth);
    truth.tick = 12;
    deliverReportsPass(truth, e => applyEvent(truth, e));
    expect(truth.contacts['c-x'].delivered).toEqual(truth.reports['r1'].snapshot);
  });
});
