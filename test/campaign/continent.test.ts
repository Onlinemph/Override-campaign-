/** The continent generator (D-041): geography with structure, so chokepoints emerge. */
import { describe, expect, it } from 'vitest';
import { generateContinent } from '../../src/campaign/continent.js';
import { generateCampaign } from '../../src/campaign/generate.js';
import { validateCampaign } from '../../src/campaign/schema.js';
import { hexEntryCost } from '../../src/engine/movement.js';
import { addMechFormation, baseTruth, gp, T } from '../helpers.js';
import { mkTheater } from '../../src/fixtures.js';

const W = 120, H = 80;
const overrides = generateContinent({ width: W, height: H, seed: 'CHOKE-1' });
const byKey = new Map(overrides.map(o => [`${o.q},${o.r}`, o]));
const of = (t: string) => overrides.filter(o => o.terrain === t);

describe('generateContinent', () => {
  it('is deterministic and produces every feature class', () => {
    const again = generateContinent({ width: W, height: H, seed: 'CHOKE-1' });
    expect(JSON.stringify(again)).toBe(JSON.stringify(overrides));
    for (const t of ['MOUNTAIN', 'WATER', 'WOODS', 'URBAN', 'HILLS']) {
      expect(of(t).length, t).toBeGreaterThan(0);
    }
  });

  it('mountains form ranges (clustered), not speckle', () => {
    const mountains = of('MOUNTAIN');
    expect(mountains.length).toBeGreaterThan(20);
    // most mountain hexes touch another mountain hex — ridge, not noise
    const mset = new Set(mountains.map(m => `${m.q},${m.r}`));
    const touching = mountains.filter(m =>
      [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]
        .some(d => mset.has(`${m.q + d[0]},${m.r + d[1]}`))).length;
    expect(touching / mountains.length).toBeGreaterThan(0.8);
  });

  it('the road network connects every settlement, and river crossings carry bridges', () => {
    const settlements = overrides.filter(o =>
      (o.infra ?? []).some(t => t === 'CITY' || t === 'TOWN'));
    expect(settlements.length).toBeGreaterThanOrEqual(2);
    // BFS over road/rail hexes: all settlements in one component
    const roadSet = new Set(overrides
      .filter(o => (o.infra ?? []).some(t => t === 'ROAD' || t === 'RAIL'))
      .map(o => `${o.q},${o.r}`));
    for (const s of settlements) roadSet.add(`${s.q},${s.r}`);
    const start = `${settlements[0].q},${settlements[0].r}`;
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const [q, r] = stack.pop()!.split(',').map(Number);
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]) {
        const k = `${q + d[0]},${r + d[1]}`;
        if (roadSet.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
      }
    }
    for (const s of settlements) expect(seen.has(`${s.q},${s.r}`), s.infra?.join()).toBe(true);
    // every WATER hex the road crosses is bridged
    for (const o of overrides) {
      const inf = o.infra ?? [];
      if (o.terrain === 'WATER' && inf.includes('ROAD')) expect(inf).toContain('BRIDGE');
    }
    // and the trunk line got rail
    expect(overrides.some(o => (o.infra ?? []).includes('RAIL'))).toBe(true);
  });

  it('generateCampaign uses the continent for big maps and validates clean', () => {
    const camp = generateCampaign({ name: 'C', seed: 'CHOKE-2', width: 100, height: 60 });
    expect(validateCampaign(camp)).toEqual([]);
    const ov = (camp.theaters as any)[0].overrides;
    expect(ov.some((o: any) => (o.infra ?? []).includes('CITY'))).toBe(true);
    // small boards keep the classic painter (no CITY clusters guaranteed there)
    const small = generateCampaign({ name: 'S', seed: 'CHOKE-2', width: 20, height: 14 });
    expect(validateCampaign(small)).toEqual([]);
  });
});

describe('bridges over water (D-041)', () => {
  it('a bridge carries a ground column across; drop it and the river is a wall again', () => {
    const truth = baseTruth('BRIDGE-1', [
      { q: 6, r: 5, terrain: 'WATER', infra: ['ROAD', 'BRIDGE'] },
      { q: 7, r: 5, terrain: 'WATER' },
    ]);
    const f = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 5) });
    const bridged = truth.theaters[T].hexes['6,5'];
    const open = truth.theaters[T].hexes['7,5'];
    expect(hexEntryCost(truth, f, bridged)).toBe(1);   // over the bridge at road pace
    expect(hexEntryCost(truth, f, open)).toBeNull();   // the river itself: impassable
    // engineers DEMOLISH the bridge → the crossing closes
    bridged.infra = bridged.infra.filter(t => t !== 'BRIDGE');
    expect(hexEntryCost(truth, f, bridged)).toBeNull();
  });
});
