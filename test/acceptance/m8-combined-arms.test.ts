/**
 * M8 acceptance — the combined-arms kit in one scripted assault (toward the §12.3
 * Cavanaugh frame): a blockade-running false-flag raider, a combat drop onto a contested
 * spaceport, the dropped force taking the objective, and a downed crew recovered by SAR —
 * all through the campaign engine, byte-exact on replay.
 */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { rollDice } from '../../src/core/rng.js';
import { mkFacility } from '../../src/fixtures.js';
import { addMechFormation, addVessel, addSystem, baseTruth, gp } from '../helpers.js';
import type { TruthState } from '../../src/core/types.js';

const SEED = 'M8-CAVANAUGH';

function scenario(): TruthState {
  const truth = baseTruth(SEED, [
    { q: 10, r: 8, infra: ['SPACEPORT'], objective: { vpPerDay: 3, hidden: false, ownerSideId: 'blue' } },
  ], 24, 16);
  truth.config.vpThreshold = 30;
  addSystem(truth, [
    { id: 'zenith', type: 'JUMP_ZENITH', name: 'Zenith' },
    { id: 'cavanaugh', type: 'PLANET', name: 'Cavanaugh', theaterId: 'theater-1' },
  ], [['zenith', 'cavanaugh', 10]]);

  // Blue defends the spaceport and imports SP through the jump point
  truth.facilities['blue-port'] = mkFacility({ id: 'blue-port', sideId: 'blue', name: 'Port',
    pos: gp(10, 8), tags: ['SPACEPORT', 'DEPOT'], supplyPoints: 10, isCommandNode: true });
  truth.sides['blue'].commandNodes = ['blue-port'];
  truth.sides['blue'].importSpPerDay = 5;
  truth.sides['blue'].homeDepotId = 'blue-port';
  addMechFormation(truth, { id: 'blue-garrison', sideId: 'blue', pos: gp(10, 8), sigBase: 6 });

  // Red brings an assault DropShip (carrier) with an embarked marine company, squawking
  // as a merchant to slip past the picket
  const carrier = addMechFormation(truth, { id: 'red-carrier', sideId: 'red', pos: gp(10, 8) },
    1, { class: 'DROPSHIP' });
  carrier.squawk = 'free trader Beowulf';
  const marines = addMechFormation(truth, { id: 'red-marines', sideId: 'red', pos: gp(10, 8), sigBase: 6 });
  marines.mounted = { carrierFormationId: 'red-carrier' };
  return truth;
}

describe('M8 acceptance — the Cavanaugh assault', () => {
  it('false flag → blockade → combat drop → objective taken → SAR, all on one timeline', () => {
    const c = Campaign.create(scenario());

    // 1) the picket inspects the "merchant" — a logged 2d6 vs TN 9 decides the lie
    const flagRoll = rollDice(SEED, c.truth.seedCursor, '2d6').result;
    const insp = c.inspectTransponder('red-carrier', 'blue');
    expect(insp.ok).toBe(true);
    if (insp.ok) expect(insp.held).toBe(flagRoll >= 9);
    if (insp.ok && !insp.held) {
      expect(c.truth.contacts['contact:blue:red-carrier'].level).toBe(4); // unmasked at LOCK
    }

    // 2) a red WarShip jumps in and blockades the zenith point → blue's imports stop
    c.spawnFormation(
      { id: 'red-ws', sideId: 'red', name: 'Pocket WarShip', unitIds: ['ws-1'],
        pos: { kind: 'node', nodeId: 'zenith' }, omp: 0, br: 50, sigBase: 8,
        sns: { passive: 1, active: 1 }, rdy: 10, emcon: 'PASSIVE', posture: 'NONE',
        onNet: true, standingOrderIds: [], supply: { lastSuppliedTick: 0, inSupply: true } },
      [{ id: 'ws-1', sideId: 'red', name: 'Vincent', model: 'Vincent', class: 'WARSHIP',
        bv: 0, pv: 0, walkOrCruise: 0, run: 0, jump: 0, damage: 'OK', pilotIds: [],
        ammoState: 'FULL', tags: [] }]);
    const portSpStart = c.truth.facilities['blue-port'].supplyPoints;
    while (c.truth.tick <= 240) c.step(); // a day passes under blockade
    // no +5 import arrived (the farm only drained as the garrison drew its ration)
    expect(c.truth.facilities['blue-port'].supplyPoints).toBeLessThanOrEqual(portSpStart);
    expect(c.store.all().some(l => l.event.type === 'BLOCKADE_STATE' &&
      (l.event as { blockaded: boolean; sideId: string }).blockaded &&
      (l.event as { sideId: string }).sideId === 'blue')).toBe(true);

    // 3) the marines drop onto the spaceport, revealed at LOCK to the defender
    const drop = c.combatDrop('red-carrier', 'red-marines', gp(10, 8));
    expect(drop.ok).toBe(true);
    expect(c.truth.contacts['contact:blue:red-marines'].level).toBe(4);
    const mPos = c.truth.formations['red-marines'].pos as { kind: string };
    expect(mPos.kind).toBe('ground');

    // 4) the assault carries the spaceport: the GM removes the garrison (lost the battle),
    //    leaving red sole holder → objective flips → red scores it
    c.destroyFormation('blue-garrison', 'overrun in the drop assault');
    // move the marines onto the objective hex if they scattered off it
    if ((c.truth.formations['red-marines'].pos as { q: number }).q !== 10 ||
        (c.truth.formations['red-marines'].pos as { r: number }).r !== 8) {
      c.inject({ type: 'FORMATION_MOVED', formationId: 'red-marines', to: gp(10, 8),
        movedKind: 'NORMAL', onRoad: false, headingDeg: 0, tick: c.truth.tick });
    }
    const redVpBefore = c.truth.sides['red'].vp;
    let guard = 0;
    while (c.truth.sides['red'].vp === redVpBefore && guard++ < 2000) c.step();
    expect(c.truth.theaters['theater-1'].hexes['10,8'].objective!.ownerSideId).toBe('red');
    expect(c.truth.sides['red'].vp).toBeGreaterThan(redVpBefore); // red now scores the port

    // 5) SAR: a downed Davion crew on the field is recovered by a VTOL (all via the log)
    c.spawnFormation(
      { id: 'blue-sar', sideId: 'blue', name: 'Rescue Flight', unitIds: ['sar-1'],
        pos: gp(11, 8), omp: 8, br: 5, sigBase: 9, sns: { passive: 4, active: 8 }, rdy: 10,
        emcon: 'PASSIVE', posture: 'NONE', onNet: true, standingOrderIds: [],
        supply: { lastSuppliedTick: c.truth.tick, inSupply: true } },
      [{ id: 'sar-1', sideId: 'blue', name: 'Ferret', model: 'Ferret VTOL', class: 'VTOL',
        bv: 100, pv: 5, walkOrCruise: 8, run: 12, jump: 0, damage: 'OK', pilotIds: [],
        ammoState: 'FULL', tags: ['RECON'] }],
      [{ id: 'davion-1', name: 'Lt. Hale', gunnery: 4, piloting: 5, kills: 0, ace: false,
        fatigue: 0, status: 'DOWNED' }]);
    c.inject({ type: 'MARKER_ADDED', marker: { id: 'crew', kind: 'DOWNED_CREW',
      pos: gp(11, 8), payload: { pilotId: 'davion-1' }, beaconActive: true } });
    expect(c.recoverDownedCrew('blue-sar', 'crew').ok).toBe(true);
    expect(c.truth.pilots['davion-1'].status).toBe('POOL');

    // the whole assault is auditable
    expect(replay(c.store.all())).toEqual(c.truth);
    for (const l of c.store.all()) {
      if (l.event.type === 'DIE_ROLLED') {
        expect(rollDice(SEED, l.event.roll.seedCursor, l.event.roll.dice).result)
          .toBe(l.event.roll.result);
      }
    }
  });
});
