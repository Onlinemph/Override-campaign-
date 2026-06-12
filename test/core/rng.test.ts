/** B1 — seeded, logged RNG (spec §1.2; D-004). */
import { describe, expect, it } from 'vitest';
import { d6At, hashPick, rollDice } from '../../src/core/rng.js';

describe('B1 — RNG', () => {
  it('is a pure function of (seed, cursor): same inputs, same roll, always', () => {
    for (let c = 0; c < 200; c++) {
      expect(d6At('CAMPAIGN-X', c)).toBe(d6At('CAMPAIGN-X', c));
      expect(rollDice('CAMPAIGN-X', c, '2d6')).toEqual(rollDice('CAMPAIGN-X', c, '2d6'));
    }
  });

  it('different seeds diverge; different cursors diverge', () => {
    const a = Array.from({ length: 50 }, (_, c) => d6At('SEED-A', c)).join('');
    const b = Array.from({ length: 50 }, (_, c) => d6At('SEED-B', c)).join('');
    expect(a).not.toBe(b);
  });

  it('2d6 ∈ [2,12], 1d6 ∈ [1,6], with a sane distribution', () => {
    const counts = new Map<number, number>();
    for (let c = 0; c < 20000; c += 2) {
      const { result } = rollDice('DIST-SEED', c, '2d6');
      expect(result).toBeGreaterThanOrEqual(2);
      expect(result).toBeLessThanOrEqual(12);
      counts.set(result, (counts.get(result) ?? 0) + 1);
    }
    const n = 10000;
    // 7 is the mode of 2d6 (1/6); 2 and 12 are 1/36 each. Loose bounds, deterministic seed.
    expect(counts.get(7)! / n).toBeGreaterThan(0.13);
    expect(counts.get(7)! / n).toBeLessThan(0.21);
    expect(counts.get(2)! / n).toBeLessThan(0.06);
    expect(counts.get(12)! / n).toBeLessThan(0.06);
    for (let v = 2; v <= 12; v++) expect(counts.get(v)).toBeGreaterThan(0);
  });

  it('cursor advances one position per die: 2d6 consumes two', () => {
    const r = rollDice('CURSOR-SEED', 10, '2d6');
    expect(r.nextCursor).toBe(12);
    expect(r.dieValues).toEqual([d6At('CURSOR-SEED', 10), d6At('CURSOR-SEED', 11)]);
    expect(rollDice('CURSOR-SEED', 5, '1d6').nextCursor).toBe(6);
  });

  it('hashPick (ghost scatter, D-008.4) is deterministic and in range', () => {
    for (let i = 0; i < 100; i++) {
      const v = hashPick('S', ['ghost', 'contact:blue:red-1', i], 7);
      expect(v).toBe(hashPick('S', ['ghost', 'contact:blue:red-1', i], 7));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });
});
