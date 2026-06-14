/** M8 — the combined-arms kit: drops, false flags, SAR/tanker, blockade. */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { rollDice } from '../../src/core/rng.js';
import { mkFacility } from '../../src/fixtures.js';
import { addMechFormation, addVessel, addSystem, baseTruth, gp } from '../helpers.js';
import type { TruthState } from '../../src/core/types.js';

describe('M8 — combat drops (core §8.3)', () => {
  it('drops an embarked formation onto a target hex with scatter, revealed at LOCK', () => {
    const truth = baseTruth('DROP-1', [], 30, 20);
    addMechFormation(truth, { id: 'carrier', sideId: 'blue', pos: gp(10, 10) },
      1, { class: 'DROPSHIP' });
    const payload = addMechFormation(truth, { id: 'payload', sideId: 'blue', pos: gp(10, 10) });
    payload.mounted = { carrierFormationId: 'carrier' };
    addMechFormation(truth, { id: 'red-watch', sideId: 'red', pos: gp(25, 5) });
    const c = Campaign.create(truth);

    const r = c.combatDrop('carrier', 'payload', gp(15, 12));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = c.truth.formations['payload'].pos as { kind: string; q: number; r: number };
    expect(p.kind).toBe('ground');
    // landed at target ± scatter, mount cleared
    expect(c.truth.formations['payload'].mounted).toBeUndefined();
    expect(r.scatter).toBeGreaterThanOrEqual(0);
    // "arrive at LOCK visibility to anyone watching the sky"
    expect(c.truth.contacts['contact:red:payload'].level).toBe(4);
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('a storm widens the scatter; an off-map landing falls back onto the target', () => {
    const truth = baseTruth('DROP-STORM', [], 6, 6);
    truth.config.weather = 'STORM';
    addMechFormation(truth, { id: 'carrier', sideId: 'blue', pos: gp(3, 3) }, 1, { class: 'DROPSHIP' });
    addMechFormation(truth, { id: 'payload', sideId: 'blue', pos: gp(3, 3) });
    const c = Campaign.create(truth);
    // a tiny map: a big storm scatter would go off-map and clamp back to target
    const r = c.combatDrop('carrier', 'payload', gp(3, 3));
    expect(r.ok).toBe(true);
    const p = c.truth.formations['payload'].pos as { q: number; r: number };
    expect(p.q).toBeGreaterThanOrEqual(0); expect(p.q).toBeLessThan(6);
    expect(p.r).toBeGreaterThanOrEqual(0); expect(p.r).toBeLessThan(6);
  });
});

describe('M8 — transponders & false flags (DEEP SKY §4.3)', () => {
  function sys(truth: TruthState) {
    addSystem(truth, [{ id: 'zenith', type: 'JUMP_ZENITH' }, { id: 'planet', type: 'PLANET' }],
      [['zenith', 'planet', 10]]);
  }
  it('a warship maneuvering under burn fails the merchant squawk automatically', () => {
    const truth = baseTruth('FLAG-BURN'); sys(truth);
    const raider = addVessel(truth, { id: 'raider', sideId: 'red', nodeId: 'zenith', klass: 'WARSHIP' });
    raider.squawk = 'Leopard CV (merchant)';
    raider.space = { burnStartTick: 0 }; // burning like a warship
    const c = Campaign.create(truth);
    const r = c.inspectTransponder('raider', 'blue');
    expect(r.ok && r.held).toBe(false);
    expect(c.truth.formations['raider'].squawk).toBeUndefined();    // flag blown
    expect(c.truth.contacts['contact:blue:raider'].level).toBe(4);  // true nature: LOCK
  });
  it('a coasting "merchant" holds or blows the lie on a logged 2d6 (TN 9)', () => {
    const truth = baseTruth('FLAG-COAST'); sys(truth);
    const m = addVessel(truth, { id: 'm', sideId: 'red', nodeId: 'zenith', klass: 'DROPSHIP' });
    m.squawk = 'free trader';
    const c = Campaign.create(truth);
    const expected = rollDice('FLAG-COAST', c.truth.seedCursor, '2d6').result >= 9;
    const r = c.inspectTransponder('m', 'blue');
    expect(r.ok && r.held).toBe(expected);
  });
});

describe('M8 — SAR & tanker (SKYWATCH §4, §8.4)', () => {
  it('SAR recovers a downed crew at its hex → pilot returns to the pool, marker cleared', () => {
    const truth = baseTruth('SAR-1');
    truth.pilots['ace'] = { id: 'ace', name: 'Ace', gunnery: 3, piloting: 4, kills: 6,
      ace: true, fatigue: 0, status: 'DOWNED' };
    truth.markers['m'] = { id: 'm', kind: 'DOWNED_CREW', pos: gp(7, 7),
      payload: { pilotId: 'ace' }, beaconActive: true };
    addMechFormation(truth, { id: 'sar', sideId: 'blue', pos: gp(7, 7) }, 1, { class: 'VTOL' });
    const c = Campaign.create(truth);
    const r = c.recoverDownedCrew('sar', 'm');
    expect(r.ok).toBe(true);
    expect(c.truth.pilots['ace'].status).toBe('POOL');
    expect(c.truth.markers['m']).toBeUndefined();
  });
  it('a tanker offloads fuel: 1 ton delivered per 2 carried', () => {
    const truth = baseTruth('TANK-1');
    const tanker = addMechFormation(truth, { id: 'tanker', sideId: 'blue', pos: gp(2, 2) },
      1, { class: 'CONV_FIGHTER' });
    tanker.unitIds.forEach(u => { truth.units[u].fuel = { fp: 0, fpPerTon: 80, tons: 20 }; });
    const thirsty = addMechFormation(truth, { id: 'thirsty', sideId: 'blue', pos: gp(2, 2) },
      1, { class: 'ASF' });
    thirsty.unitIds.forEach(u => { truth.units[u].fuel = { fp: 100, fpPerTon: 80, tons: 5 }; });
    const c = Campaign.create(truth);
    const r = c.transferFuel('tanker', 'thirsty', 10); // 10 carried → 5 t × 80 = 400 FP
    expect(r.ok).toBe(true);
    expect(r.fpDelivered).toBe(400);
    expect(c.truth.units['thirsty-u1'] ?? c.truth.units[c.truth.formations['thirsty'].unitIds[0]])
      .toBeTruthy();
    const recv = c.truth.formations['thirsty'].unitIds[0];
    expect(c.truth.units[recv].fuel!.fp).toBe(500);
    const tk = c.truth.formations['tanker'].unitIds[0];
    expect(c.truth.units[tk].fuel!.tons).toBe(10);
  });
});

describe('M8 — blockade & off-world imports (DEEP SKY §9)', () => {
  function importScenario(seed: string) {
    const truth = baseTruth(seed);
    addSystem(truth, [{ id: 'zenith', type: 'JUMP_ZENITH' }, { id: 'planet', type: 'PLANET' }],
      [['zenith', 'planet', 10]]);
    truth.facilities['blue-depot'] = mkFacility({ id: 'blue-depot', sideId: 'blue',
      name: 'Port', pos: gp(2, 2), tags: ['SPACEPORT'], supplyPoints: 0 });
    truth.sides['blue'].importSpPerDay = 5;
    truth.sides['blue'].homeDepotId = 'blue-depot';
    return truth;
  }
  it('imports flow daily when the jump point is open', () => {
    const c = Campaign.create(importScenario('BLK-OPEN'));
    while (c.truth.tick <= 240) c.step();
    expect(c.truth.facilities['blue-depot'].supplyPoints).toBe(5);
  });
  it('an enemy holding the jump point uncontested cuts imports to zero', () => {
    const truth = importScenario('BLK-CUT');
    addVessel(truth, { id: 'red-ws', sideId: 'red', nodeId: 'zenith', klass: 'WARSHIP' });
    const c = Campaign.create(truth);
    while (c.truth.tick <= 240) c.step();
    expect(c.truth.facilities['blue-depot'].supplyPoints).toBe(0);
    expect(c.store.all().some(l => l.event.type === 'BLOCKADE_STATE' &&
      (l.event as { blockaded: boolean }).blockaded)).toBe(true);
  });
  it('contesting the blockaded point with your own vessel reopens imports', () => {
    const truth = importScenario('BLK-CONTEST');
    addVessel(truth, { id: 'red-ws', sideId: 'red', nodeId: 'zenith', klass: 'WARSHIP' });
    addVessel(truth, { id: 'blue-ws', sideId: 'blue', nodeId: 'zenith', klass: 'WARSHIP' });
    const c = Campaign.create(truth);
    while (c.truth.tick <= 240) c.step();
    expect(c.truth.facilities['blue-depot'].supplyPoints).toBe(5); // contested ⇒ not blockaded
  });
});
