/**
 * hex/axial.ts — hand-rolled axial hex math (D-003).
 * Axial coordinates (q, r) with cube identity s = -q-r. Pointy/flat agnostic.
 */

export interface Axial { q: number; r: number }

export const AXIAL_DIRECTIONS: Axial[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function neighbors(h: Axial): Axial[] {
  return AXIAL_DIRECTIONS.map(d => ({ q: h.q + d.q, r: h.r + d.r }));
}

export function hexesWithin(center: Axial, range: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -range; q <= range; q++) {
    for (let r = Math.max(-range, -q - range); r <= Math.min(range, -q + range); r++) {
      out.push({ q: center.q + q, r: center.r + r });
    }
  }
  return out;
}

function cubeRound(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/** All hexes on the line a→b inclusive (cube lerp + round). */
export function hexLine(a: Axial, b: Axial): Axial[] {
  const n = hexDistance(a, b);
  if (n === 0) return [{ ...a }];
  const out: Axial[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // tiny epsilon nudge avoids landing exactly on hex edges
    out.push(cubeRound(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 1e-6));
  }
  return out;
}

/** Heading in degrees (0 = +q axis, counterclockwise) from a to b. */
export function headingDeg(a: Axial, b: Axial): number {
  // axial → approximate cartesian (pointy-top)
  const x = (b.q - a.q) + (b.r - a.r) / 2;
  const y = (b.r - a.r) * Math.sqrt(3) / 2;
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Distance from point p to the polyline (corridor centerline). */
export function distanceToPath(p: Axial, path: Axial[]): number {
  let best = Infinity;
  for (const node of path) best = Math.min(best, hexDistance(p, node));
  // also check the line hexes between consecutive nodes
  for (let i = 0; i + 1 < path.length; i++) {
    for (const h of hexLine(path[i], path[i + 1])) {
      best = Math.min(best, hexDistance(p, h));
    }
  }
  return best;
}
