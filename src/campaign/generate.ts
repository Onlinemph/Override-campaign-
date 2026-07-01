/**
 * campaign/generate.ts — a seeded, deterministic campaign generator. Produces a valid
 * campaign JSON (the same shape the editor + loader consume) with COHERENT terrain —
 * blobs of woods / hills / water / rough / swamp / mountain grown from random centers,
 * plus a town or two joined by a road — so a generated map reads like a place, not
 * speckle. Pure: no fs / DOM / campaign RNG; same seed ⇒ same map. The GM paints over it
 * and adds objectives/bases in the editor; armies are rolled/imported separately.
 */
import type { InfraTag, TerrainType } from '../core/types.js';

export interface GenOverride { q: number; r: number; terrain?: TerrainType; infra?: InfraTag[] }
export interface GenSide { id: string; name: string }
export interface GenParams {
  name?: string;
  seed?: string;
  width: number;
  height: number;
  sides?: GenSide[];
}

// axial neighbours (q,r)
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1],
];

function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (q: number, r: number) => `${q},${r}`;

/** Grow a connected blob of ~`size` in-bounds hexes from a random center. */
function growBlob(rng: () => number, w: number, h: number, size: number): Array<[number, number]> {
  const start: [number, number] = [Math.floor(rng() * w), Math.floor(rng() * h)];
  const inb = (q: number, r: number) => q >= 0 && q < w && r >= 0 && r < h;
  const seen = new Set<string>([key(start[0], start[1])]);
  const frontier: Array<[number, number]> = [start];
  let guard = size * 20;
  while (seen.size < size && frontier.length && guard-- > 0) {
    const i = Math.floor(rng() * frontier.length);
    const [q, r] = frontier[i]!;
    const d = DIRS[Math.floor(rng() * DIRS.length)]!;
    const nq = q + d[0], nr = r + d[1];
    if (inb(nq, nr) && !seen.has(key(nq, nr))) {
      seen.add(key(nq, nr));
      frontier.push([nq, nr]);
    } else if (rng() < 0.12) {
      frontier.splice(i, 1); // retire a stuck frontier cell
    }
  }
  return [...seen].map(k => k.split(',').map(Number) as [number, number]);
}

// terrain features, painted in order (later overwrites earlier where they overlap)
const FEATURES: ReadonlyArray<{ terrain: TerrainType; cov: number; blob: [number, number] }> = [
  { terrain: 'WATER', cov: 0.06, blob: [4, 10] },
  { terrain: 'WOODS', cov: 0.18, blob: [4, 12] },
  { terrain: 'HILLS', cov: 0.12, blob: [4, 10] },
  { terrain: 'ROUGH', cov: 0.07, blob: [2, 6] },
  { terrain: 'SWAMP', cov: 0.03, blob: [2, 5] },
  { terrain: 'MOUNTAIN', cov: 0.02, blob: [2, 5] },
];

/** A greedy hex path between two hexes (for drawing a road). */
function hexPath(a: [number, number], b: [number, number]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let [q, r] = a;
  let guard = 200;
  while ((q !== b[0] || r !== b[1]) && guard-- > 0) {
    out.push([q, r]);
    // step along whichever axis is furthest from the target
    if (Math.abs(b[0] - q) >= Math.abs(b[1] - r)) q += Math.sign(b[0] - q);
    else r += Math.sign(b[1] - r);
  }
  out.push(b);
  return out;
}

/** Generate coherent terrain overrides for a width×height theater. */
export function generateOverrides(params: { width: number; height: number; seed?: string }): GenOverride[] {
  const { width: w, height: h } = params;
  const rng = mulberry32(strHash(params.seed ?? 'CAMPAIGN-1'));
  const area = w * h;
  const cells = new Map<string, { terrain?: TerrainType; infra: Set<InfraTag> }>();
  const cell = (q: number, r: number) => {
    const k = key(q, r);
    let c = cells.get(k);
    if (!c) { c = { infra: new Set() }; cells.set(k, c); }
    return c;
  };

  for (const f of FEATURES) {
    let placed = 0;
    const target = Math.round(area * f.cov);
    let guard = 100;
    while (placed < target && guard-- > 0) {
      const size = f.blob[0] + Math.floor(rng() * (f.blob[1] - f.blob[0] + 1));
      for (const [q, r] of growBlob(rng, w, h, size)) { cell(q, r).terrain = f.terrain; placed++; }
    }
  }

  // one or two towns joined by a road (skip on very small maps)
  const townCount = area >= 60 ? 2 : area >= 24 ? 1 : 0;
  const towns: Array<[number, number]> = [];
  for (let i = 0; i < townCount; i++) {
    const t: [number, number] = [Math.floor(rng() * w), Math.floor(rng() * h)];
    const c = cell(t[0], t[1]);
    c.terrain = 'URBAN';
    c.infra.add('TOWN');
    towns.push(t);
  }
  if (towns.length === 2) for (const [q, r] of hexPath(towns[0]!, towns[1]!)) cell(q, r).infra.add('ROAD');

  const overrides: GenOverride[] = [];
  for (const [k, c] of cells) {
    if (!c.terrain && c.infra.size === 0) continue;
    const [q, r] = k.split(',').map(Number);
    overrides.push({
      q: q!, r: r!,
      ...(c.terrain ? { terrain: c.terrain } : {}),
      ...(c.infra.size ? { infra: [...c.infra] } : {}),
    });
  }
  overrides.sort((a, b) => a.r - b.r || a.q - b.q);
  return overrides;
}

/** Generate a complete, valid (map-only) campaign JSON. Armies/objectives added later. */
export function generateCampaign(params: GenParams): Record<string, unknown> {
  const width = Math.max(1, Math.round(params.width));
  const height = Math.max(1, Math.round(params.height));
  const seed = params.seed ?? 'CAMPAIGN-1';
  const sides = params.sides?.length ? params.sides : [{ id: 'blue', name: 'Blue' }, { id: 'red', name: 'Red' }];
  return {
    seed,
    config: { name: params.name ?? 'Generated Campaign', dawnTick: 60, duskTick: 180, weather: 'CLEAR' },
    theaters: [{
      id: 'theater', name: 'Theater', width, height,
      defaultTerrain: 'CLEAR', overrides: generateOverrides({ width, height, seed }),
    }],
    sides,
    facilities: [], satellites: [], formations: [], commandNodes: {}, orders: [],
    system: { nodes: [], lanes: [] }, markers: [],
  };
}
