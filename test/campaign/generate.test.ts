import { describe, expect, it } from 'vitest';
import { generateCampaign, generateOverrides } from '../../src/campaign/generate.js';
import { validateCampaign, TERRAINS, INFRA } from '../../src/campaign/schema.js';

describe('campaign generator — coherent terrain', () => {
  it('is deterministic: same seed ⇒ identical map', () => {
    const a = generateOverrides({ width: 20, height: 14, seed: 'SEED-A' });
    const b = generateOverrides({ width: 20, height: 14, seed: 'SEED-A' });
    expect(a).toEqual(b);
  });

  it('different seeds give different maps', () => {
    const a = generateOverrides({ width: 20, height: 14, seed: 'SEED-A' });
    const b = generateOverrides({ width: 20, height: 14, seed: 'SEED-B' });
    expect(a).not.toEqual(b);
  });

  it('every override is in-bounds with valid terrain/infra', () => {
    const w = 24, h = 18;
    const ov = generateOverrides({ width: w, height: h, seed: 'BOUNDS' });
    expect(ov.length).toBeGreaterThan(0);
    for (const o of ov) {
      expect(o.q).toBeGreaterThanOrEqual(0);
      expect(o.q).toBeLessThan(w);
      expect(o.r).toBeGreaterThanOrEqual(0);
      expect(o.r).toBeLessThan(h);
      if (o.terrain) expect(TERRAINS).toContain(o.terrain);
      for (const tag of o.infra ?? []) expect(INFRA).toContain(tag);
    }
  });

  it('produces coherent clusters, not pure speckle', () => {
    // a WOODS hex should almost always have a same-terrain neighbour
    const ov = generateOverrides({ width: 30, height: 30, seed: 'CLUSTER' });
    const woods = new Set(ov.filter(o => o.terrain === 'WOODS').map(o => `${o.q},${o.r}`));
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
    let clustered = 0;
    for (const k of woods) {
      const [q, r] = k.split(',').map(Number);
      if (dirs.some(d => woods.has(`${q! + d[0]},${r! + d[1]}`))) clustered++;
    }
    expect(clustered / woods.size).toBeGreaterThan(0.7);
  });

  it('generateCampaign yields a valid campaign the loader accepts', () => {
    const camp = generateCampaign({ name: 'Test Front', seed: 'VALID', width: 20, height: 14 });
    expect(validateCampaign(camp)).toEqual([]);
    const t = (camp as any).theaters[0];
    expect(t.width).toBe(20);
    expect(t.defaultTerrain).toBe('CLEAR');
    expect((camp as any).sides.map((s: any) => s.id)).toEqual(['blue', 'red']);
  });

  it('honors custom sides and clamps tiny maps', () => {
    const camp = generateCampaign({ seed: 'S', width: 3, height: 3,
      sides: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }, { id: 'c', name: 'Charlie' }] });
    expect(validateCampaign(camp)).toEqual([]);
    expect((camp as any).sides).toHaveLength(3);
  });
});
