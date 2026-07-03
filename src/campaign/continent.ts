/**
 * campaign/continent.ts — the structured-geography generator (D-041).
 *
 * The classic generator (generate.ts) scatters coherent blobs — fine for a 20×14 board,
 * noise at 200×150. This one builds a CONTINENT the way continents work, so chokepoints
 * emerge instead of being placed:
 *
 *   elevation  — ridgeline mountain RANGES (walls to every vehicle) with carved PASSES
 *   ocean      — a coastal sea along chosen edges; low ground drowns
 *   rivers     — walk downhill from the ridges to the sea; WATER lines a column can
 *                cross only where a road BRIDGES them (and engineers can drop bridges)
 *   forests    — biome-scale woods, not speckle
 *   cities     — an URBAN-cluster capital and satellite towns, sited near water & flat
 *   the network— roads pathfound between settlements over the real terrain costs, so
 *                they funnel through the passes and bridge the rivers; the two biggest
 *                cities get RAIL. The map itself decides where the war narrows.
 *
 * Pure and deterministic: same seed ⇒ same continent. Output is GenOverride[] — the
 * same shape the editor, loader, and classic generator speak.
 */
import type { InfraTag, TerrainType } from '../core/types.js';
import type { GenOverride } from './generate.js';

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1],
];
const key = (q: number, r: number) => `${q},${r}`;
const hexDist = (aq: number, ar: number, bq: number, br: number) => {
  const dq = aq - bq, dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};

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

export interface ContinentParams { width: number; height: number; seed?: string }

export function generateContinent(params: ContinentParams): GenOverride[] {
  const w = params.width, h = params.height;
  const rng = mulberry32(strHash((params.seed ?? 'CONTINENT-1') + ':continent'));
  const area = w * h;
  const inb = (q: number, r: number) => q >= 0 && q < w && r >= 0 && r < h;
  const idx = (q: number, r: number) => r * w + q;

  // ── 1. elevation ──────────────────────────────────────────────────────────
  const elev = new Float32Array(area); // 0 = plain; + = high; − = wet
  for (let i = 0; i < area; i++) elev[i] = (rng() - 0.5) * 0.16;

  // mountain ranges: wandering ridgelines with distance falloff
  const ranges = Math.max(1, Math.round(Math.sqrt(area) / 28));
  const ridgeLines: Array<Array<[number, number]>> = [];
  for (let i = 0; i < ranges; i++) {
    const len = Math.round((0.35 + rng() * 0.3) * Math.min(w, h));
    let q = Math.floor(w * (0.15 + rng() * 0.7));
    let r = Math.floor(h * (0.15 + rng() * 0.7));
    let dir = Math.floor(rng() * 6);
    const line: Array<[number, number]> = [];
    for (let step = 0; step < len; step++) {
      if (!inb(q, r)) break;
      line.push([q, r]);
      if (rng() < 0.3) dir = (dir + (rng() < 0.5 ? 1 : 5)) % 6; // wander
      q += DIRS[dir]![0]; r += DIRS[dir]![1];
    }
    if (line.length >= 4) ridgeLines.push(line);
    // raise the land around the ridge (falloff over ~3 hexes)
    for (const [rq, rr] of line) {
      for (let dq = -3; dq <= 3; dq++) for (let dr = -3; dr <= 3; dr++) {
        const nq = rq + dq, nr = rr + dr;
        if (!inb(nq, nr)) continue;
        const d = hexDist(rq, rr, nq, nr);
        if (d <= 3) elev[idx(nq, nr)] += Math.max(0, 1.1 - d * 0.34);
      }
    }
  }

  // ocean: one or two edges get a coastal sea (depth varies along the shore)
  const coastEdges = ['S', 'E', 'N', 'W'].filter(() => rng() < 0.45);
  if (coastEdges.length === 0) coastEdges.push(rng() < 0.5 ? 'S' : 'E');
  const phase = rng() * 6.28;
  for (const edge of coastEdges) {
    const along = edge === 'N' || edge === 'S' ? w : h;
    const base = 2 + rng() * Math.max(2, Math.min(w, h) * 0.08);
    for (let a = 0; a < along; a++) {
      const depth = Math.max(1, Math.round(base + Math.sin(phase + a / 7) * base * 0.6));
      for (let d = 0; d < depth; d++) {
        const [q, r] = edge === 'N' ? [a, d] : edge === 'S' ? [a, h - 1 - d]
          : edge === 'W' ? [d, a] : [w - 1 - d, a];
        if (inb(q, r)) elev[idx(q, r)] -= 2.2 * (1 - d / depth) + 0.4;
      }
    }
  }

  // ── 2. paint terrain from elevation ──────────────────────────────────────
  const terrain: (TerrainType | undefined)[] = new Array(area);
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    const e = elev[idx(q, r)]!;
    terrain[idx(q, r)] = e <= -0.35 ? 'WATER'
      : e >= 0.95 ? 'MOUNTAIN'
      : e >= 0.55 ? 'HILLS'
      : e >= 0.4 ? 'ROUGH'
      : undefined; // CLEAR (theater default)
  }

  // ── 3. passes: carve 1–2 crossings through each range ────────────────────
  for (const line of ridgeLines) {
    const passes = 1 + (line.length > 14 && rng() < 0.6 ? 1 : 0);
    for (let p = 0; p < passes; p++) {
      const at = line[Math.floor(line.length * (0.25 + 0.5 * rng()))]!;
      for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) {
        const nq = at[0] + dq, nr = at[1] + dr;
        if (!inb(nq, nr) || hexDist(at[0], at[1], nq, nr) > 1) continue;
        if (terrain[idx(nq, nr)] === 'MOUNTAIN') terrain[idx(nq, nr)] = 'ROUGH';
      }
    }
  }

  // ── 4. rivers: downhill walks from the ridges to the sea ─────────────────
  const rivers = ridgeLines.length + 1;
  for (let i = 0; i < rivers; i++) {
    const src = ridgeLines.length
      ? ridgeLines[i % ridgeLines.length]![Math.floor(rng() * ridgeLines[i % ridgeLines.length]!.length)]!
      : [Math.floor(rng() * w), Math.floor(rng() * h)] as [number, number];
    let [q, r] = src;
    const visited = new Set<string>();
    for (let step = 0; step < w + h; step++) {
      if (!inb(q, r) || visited.has(key(q, r))) break;
      visited.add(key(q, r));
      if (terrain[idx(q, r)] === 'WATER') break; // reached the sea (or another river)
      if (terrain[idx(q, r)] !== 'MOUNTAIN') terrain[idx(q, r)] = 'WATER';
      // flow to the lowest neighbor (tiny noise breaks ties into meanders)
      let best: [number, number] | null = null, bestE = Infinity;
      for (const d of DIRS) {
        const nq = q + d[0], nr = r + d[1];
        if (!inb(nq, nr) || visited.has(key(nq, nr))) continue;
        const e = elev[idx(nq, nr)]! + (rng() - 0.5) * 0.08;
        if (e < bestE) { bestE = e; best = [nq, nr]; }
      }
      if (!best) break;
      [q, r] = best;
    }
  }

  // ── 5. forests & swamps: biomes on the land ───────────────────────────────
  const landIdx: number[] = [];
  for (let i = 0; i < area; i++) if (!terrain[i]) landIdx.push(i);
  const woodTarget = Math.round(landIdx.length * 0.2);
  let wooded = 0, guard = 200;
  while (wooded < woodTarget && guard-- > 0) {
    const start = landIdx[Math.floor(rng() * landIdx.length)]!;
    const size = 12 + Math.floor(rng() * Math.max(12, area / 250));
    const frontier = [start];
    const seen = new Set<number>([start]);
    while (seen.size < size && frontier.length) {
      const i = Math.floor(rng() * frontier.length);
      const cur = frontier[i]!;
      const cq = cur % w, cr = Math.floor(cur / w);
      const d = DIRS[Math.floor(rng() * 6)]!;
      const nq = cq + d[0], nr = cr + d[1];
      const ni = idx(nq, nr);
      if (inb(nq, nr) && !seen.has(ni) && !terrain[ni]) { seen.add(ni); frontier.push(ni); }
      else if (rng() < 0.15) frontier.splice(i, 1);
    }
    for (const i of seen) { if (!terrain[i]) { terrain[i] = 'WOODS'; wooded++; } }
  }
  // swamps hug the water line
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    if (terrain[idx(q, r)]) continue;
    const nearWater = DIRS.some(d => inb(q + d[0], r + d[1]) &&
      terrain[idx(q + d[0], r + d[1])] === 'WATER');
    if (nearWater && rng() < 0.18) terrain[idx(q, r)] = 'SWAMP';
  }

  // ── 6. settlements: a capital cluster + towns, sited flat & near water ────
  const infra = new Map<string, Set<InfraTag>>();
  const tag = (q: number, r: number, t: InfraTag) => {
    const k = key(q, r);
    let s = infra.get(k);
    if (!s) infra.set(k, s = new Set());
    s.add(t);
  };
  const count = Math.max(2, Math.round(Math.sqrt(area) / 22));
  const sites: Array<[number, number]> = [];
  let tries = 0;
  while (sites.length < count && tries++ < 4000) {
    const q = 2 + Math.floor(rng() * (w - 4)), r = 2 + Math.floor(rng() * (h - 4));
    if (terrain[idx(q, r)]) continue; // flat land only
    if (sites.some(s => hexDist(q, r, s[0], s[1]) < Math.min(w, h) / (count * 0.7))) continue;
    sites.push([q, r]);
  }
  sites.forEach(([q, r], i) => {
    terrain[idx(q, r)] = 'URBAN';
    if (i === 0) {
      tag(q, r, 'CITY');
      for (const d of DIRS) { // the capital sprawls
        const nq = q + d[0], nr = r + d[1];
        if (inb(nq, nr) && !terrain[idx(nq, nr)] && rng() < 0.7) terrain[idx(nq, nr)] = 'URBAN';
      }
    } else {
      tag(q, r, 'TOWN');
    }
  });

  // ── 7. the network: roads pathfound between settlements; rail on the trunk ──
  // A* weights make the geography choose: mountains near-forbidden, water expensive
  // (a crossing becomes a BRIDGE), woods/hills slow, existing roads cheap to reuse.
  const roadCost = (q: number, r: number, roads: Set<string>): number => {
    if (roads.has(key(q, r))) return 0.4;
    switch (terrain[idx(q, r)]) {
      case 'MOUNTAIN': return 60;
      case 'WATER': return 9; // a bridge beats a long detour
      case 'SWAMP': return 8;
      case 'HILLS': return 4;
      case 'WOODS': return 3;
      case 'ROUGH': return 3.5;
      default: return 1;
    }
  };
  const roads = new Set<string>();
  const findPath = (a: [number, number], b: [number, number]): Array<[number, number]> | null => {
    const open: Array<{ q: number; r: number; g: number; f: number }> = [
      { q: a[0], r: a[1], g: 0, f: hexDist(a[0], a[1], b[0], b[1]) }];
    const gScore = new Map<string, number>([[key(a[0], a[1]), 0]]);
    const cameFrom = new Map<string, string>();
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i;
      const cur = open.splice(bi, 1)[0]!;
      if (cur.q === b[0] && cur.r === b[1]) {
        const path: Array<[number, number]> = [];
        let k = key(b[0], b[1]);
        while (k) {
          const [q, r] = k.split(',').map(Number);
          path.unshift([q!, r!]);
          k = cameFrom.get(k)!;
          if (!k) break;
        }
        return path;
      }
      for (const d of DIRS) {
        const nq = cur.q + d[0], nr = cur.r + d[1];
        if (!inb(nq, nr)) continue;
        const nk = key(nq, nr);
        const g = cur.g + roadCost(nq, nr, roads);
        if (g < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, g);
          cameFrom.set(nk, key(cur.q, cur.r));
          open.push({ q: nq, r: nr, g, f: g + hexDist(nq, nr, b[0], b[1]) });
        }
      }
      if (gScore.size > area * 4) return null; // runaway guard
    }
    return null;
  };
  // minimum-spanning-tree-ish: connect each settlement to its nearest connected peer
  const connected: Array<[number, number]> = sites.length ? [sites[0]!] : [];
  const railPaths: Array<Array<[number, number]>> = [];
  for (let i = 1; i < sites.length; i++) {
    const from = sites[i]!;
    let near = connected[0]!;
    for (const c of connected) {
      if (hexDist(from[0], from[1], c[0], c[1]) < hexDist(from[0], from[1], near[0], near[1])) near = c;
    }
    const path = findPath(from, near);
    if (path) {
      for (const [q, r] of path) {
        tag(q, r, 'ROAD');
        roads.add(key(q, r));
        if (terrain[idx(q, r)] === 'WATER') tag(q, r, 'BRIDGE'); // the road bridges the river
      }
      if (i === 1) railPaths.push(path); // the trunk line: capital ↔ first city
    }
    connected.push(from);
  }
  for (const path of railPaths) for (const [q, r] of path) tag(q, r, 'RAIL');

  // ── emit ──────────────────────────────────────────────────────────────────
  const out: GenOverride[] = [];
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    const t = terrain[idx(q, r)];
    const inf = infra.get(key(q, r));
    if (!t && !inf?.size) continue;
    out.push({ q, r, ...(t ? { terrain: t } : {}), ...(inf?.size ? { infra: [...inf] } : {}) });
  }
  return out;
}
