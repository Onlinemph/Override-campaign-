/**
 * engine/route.ts — auto-routing with ETA (D-041).
 *
 * A* over the theater for a specific formation: costs come from hexEntryCost (so a
 * VTOL wing flies straight, a tank column detours the mountain range, and a bridge
 * makes the river crossable), and the optimized quantity is TRAVEL TIME at the pulse
 * scale — the same formula movementPass uses — so roads pull the route and a rail
 * line is worth a 20-hex detour. Pure and read-only.
 *
 * Fog discipline: pass `sideId` and the route only trusts the hexes that side has
 * scouted — everything else is assumed to be the theater's default terrain with no
 * infra, exactly what the player's own map shows. The suggested route can be wrong
 * about unscouted ground, which is as it should be.
 */
import { MOVEMENT } from '../rules.js';
import type { Formation, GroundPos, Hex, Id, TruthState } from '../core/types.js';
import { hexKey } from '../core/types.js';
import { hexDistance } from '../hex/axial.js';
import { hexEntryCost, motionFamily } from './movement.js';

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1],
];

/** What `sideId` believes hex (q,r) is — scouted truth, else bare default terrain. */
function knownHex(
  s: TruthState, theaterId: Id, q: number, r: number, sideId?: Id,
): Hex | undefined {
  const t = s.theaters[theaterId];
  const hex = t?.hexes[hexKey(q, r)];
  if (!hex) return undefined;
  if (!sideId) return hex; // GM: the truth
  const scouted = s.scoutedHexes[sideId] ?? [];
  if (scouted.includes(`${theaterId}:${q},${r}`)) return hex;
  return { ...hex, terrain: 'CLEAR', infra: [] }; // unscouted: the paper map's blank
}

/** Hours to traverse one hex at pulse scale (the operational march rate). */
function hoursPerHex(s: TruthState, f: Formation, hex: Hex, flies: boolean): number | null {
  const c = hexEntryCost(s, f, hex);
  if (c === null) return null;
  const onRoad = !flies && (hex.infra.includes('ROAD') || hex.infra.includes('RAIL'));
  const onRail = !flies && hex.infra.includes('RAIL');
  const vtolMult = flies ? MOVEMENT.VTOL_OMP_MULT : 1;
  let rate = f.omp * vtolMult * (onRoad ? MOVEMENT.ROAD_BONUS : 1);
  if (onRail) rate = Math.max(rate, MOVEMENT.RAIL_OMP);
  return 1 / Math.max(0.25, rate);
}

export interface RouteResult {
  /** Waypoints from (exclusive) start to the destination, hex by hex. */
  path: GroundPos[];
  /** Estimated march time in ticks at pulse pace (÷240 for days). */
  etaTicks: number;
}

/**
 * Best-known route for `f` from its position to (q,r). Returns null when the
 * destination is unreachable for this formation's motion family (as far as the
 * side knows). Capped at 40k explored nodes — plenty for a 300×300 theater.
 * D-049: `fromOverride` routes from somewhere the formation ISN'T yet — a plan's
 * later step routes from the previous step's destination.
 */
export function findRoute(
  s: TruthState, f: Formation, to: { q: number; r: number }, sideId?: Id,
  fromOverride?: { q: number; r: number },
): RouteResult | null {
  if (f.pos.kind !== 'ground') return null;
  const from: GroundPos = fromOverride
    ? { ...f.pos, q: fromOverride.q, r: fromOverride.r } : f.pos;
  const theaterId = from.theaterId;
  if (!knownHex(s, theaterId, to.q, to.r, sideId)) return null;
  const flies = motionFamily(s, f) === 'VTOL';

  // admissible heuristic: the fastest any hex could possibly be crossed
  const bestRate = Math.max(f.omp * (flies ? MOVEMENT.VTOL_OMP_MULT : 1) * MOVEMENT.ROAD_BONUS,
                            flies ? 0 : MOVEMENT.RAIL_OMP);
  const hMul = 1 / bestRate;

  const startK = hexKey(from.q, from.r);
  const goalK = hexKey(to.q, to.r);
  const g = new Map<string, number>([[startK, 0]]);
  const came = new Map<string, string>();
  // binary heap on f-score
  const heap: Array<{ k: string; q: number; r: number; f: number }> = [
    { k: startK, q: from.q, r: from.r, f: hexDistance(from, to) * hMul }];
  const pop = () => {
    let bi = 0;
    for (let i = 1; i < heap.length; i++) if (heap[i]!.f < heap[bi]!.f) bi = i;
    return heap.splice(bi, 1)[0]!;
  };

  let explored = 0;
  while (heap.length) {
    const cur = pop();
    if (cur.k === goalK) {
      const path: GroundPos[] = [];
      let k: string | undefined = goalK;
      while (k && k !== startK) {
        const [q, r] = k.split(',').map(Number);
        path.unshift({ kind: 'ground', theaterId, q: q!, r: r! });
        k = came.get(k);
      }
      const eta = (g.get(goalK) ?? 0) * 10; // hours → ticks (10 ticks/pulse)
      return { path, etaTicks: Math.round(eta) };
    }
    if (++explored > 40_000) return null;
    const curG = g.get(cur.k)!;
    if (curG > (g.get(cur.k) ?? Infinity)) continue;
    for (const d of DIRS) {
      const nq = cur.q + d[0], nr = cur.r + d[1];
      const hex = knownHex(s, theaterId, nq, nr, sideId);
      if (!hex) continue;
      const cost = hoursPerHex(s, f, hex, flies);
      if (cost === null) continue;
      const nk = hexKey(nq, nr);
      const ng = curG + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, cur.k);
        heap.push({ k: nk, q: nq, r: nr, f: ng + hexDistance({ q: nq, r: nr }, to) * hMul });
      }
    }
  }
  return null;
}
