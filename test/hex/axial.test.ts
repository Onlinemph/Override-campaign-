/** B3 — axial hex math (D-003). */
import { describe, expect, it } from 'vitest';
import {
  AXIAL_DIRECTIONS, distanceToPath, headingDeg, hexDistance, hexLine, hexesWithin,
  neighbors,
} from '../../src/hex/axial.js';

describe('B3 — hex math', () => {
  it('distance: identity, neighbors, straight lines, asymmetric cases', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    for (const d of AXIAL_DIRECTIONS) {
      expect(hexDistance({ q: 0, r: 0 }, d)).toBe(1);
    }
    expect(hexDistance({ q: 0, r: 0 }, { q: 5, r: 0 })).toBe(5);
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 5 })).toBe(5);
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3);
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: 3 })).toBe(5);
    expect(hexDistance({ q: -2, r: 1 }, { q: 3, r: -2 })).toBe(5);
  });

  it('neighbors: exactly 6, all at distance 1, unique', () => {
    const n = neighbors({ q: 4, r: -2 });
    expect(n).toHaveLength(6);
    expect(new Set(n.map(h => `${h.q},${h.r}`)).size).toBe(6);
    for (const h of n) expect(hexDistance({ q: 4, r: -2 }, h)).toBe(1);
  });

  it('hexesWithin: hex-count formula 1 + 3r(r+1)', () => {
    expect(hexesWithin({ q: 0, r: 0 }, 0)).toHaveLength(1);
    expect(hexesWithin({ q: 0, r: 0 }, 1)).toHaveLength(7);
    expect(hexesWithin({ q: 0, r: 0 }, 2)).toHaveLength(19);
    expect(hexesWithin({ q: 5, r: 5 }, 3)).toHaveLength(37);
    for (const h of hexesWithin({ q: 5, r: 5 }, 3)) {
      expect(hexDistance({ q: 5, r: 5 }, h)).toBeLessThanOrEqual(3);
    }
  });

  it('hexLine: inclusive, contiguous, correct length', () => {
    const line = hexLine({ q: 0, r: 0 }, { q: 4, r: 0 });
    expect(line).toHaveLength(5);
    expect(line[0]).toEqual({ q: 0, r: 0 });
    expect(line[4]).toEqual({ q: 4, r: 0 });
    for (let i = 1; i < line.length; i++) {
      expect(hexDistance(line[i - 1], line[i])).toBe(1);
    }
  });

  it('headingDeg: cardinal sanity', () => {
    expect(headingDeg({ q: 0, r: 0 }, { q: 1, r: 0 })).toBeCloseTo(0);
    expect(headingDeg({ q: 0, r: 0 }, { q: -1, r: 0 })).toBeCloseTo(180);
  });

  it('distanceToPath: corridor membership', () => {
    const path = [{ q: 0, r: 5 }, { q: 10, r: 5 }];
    expect(distanceToPath({ q: 5, r: 5 }, path)).toBe(0);
    expect(distanceToPath({ q: 5, r: 8 }, path)).toBe(3);
  });
});
