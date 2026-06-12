/**
 * core/rng.ts — seeded, logged, stateless RNG (spec §1.2, implementation note 2; D-004).
 *
 * Every die is a pure function of (campaignSeed, seedCursor): no hidden state, so any
 * roll in the log can be re-derived in isolation and replay can never drift. The cursor
 * advances one position per die (a 2d6 consumes two positions; the DieRoll records the
 * starting cursor).
 */

const MASK64 = (1n << 64n) - 1n;
const GOLDEN = 0x9e3779b97f4a7c15n;

function splitmix64(x: bigint): bigint {
  x = (x + GOLDEN) & MASK64;
  let z = x;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

/** FNV-1a 64-bit over the seed string, so human-readable campaign seeds work. */
export function seedToBigint(seed: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < seed.length; i++) {
    h = (h ^ BigInt(seed.charCodeAt(i))) & MASK64;
    h = (h * 0x100000001b3n) & MASK64;
  }
  return h;
}

/** One d6 at an absolute cursor position. Pure. */
export function d6At(seed: string, cursor: number): number {
  const state = splitmix64(seedToBigint(seed) ^ ((BigInt(cursor) * GOLDEN) & MASK64));
  // 2^64 % 6 bias is ~1e-19 — irrelevant for tabletop dice.
  return Number(state % 6n) + 1;
}

export interface RollResult { result: number; dieValues: number[]; nextCursor: number }

/** Roll '2d6' or '1d6' starting at `cursor`. Pure; caller logs the DieRoll event. */
export function rollDice(seed: string, cursor: number, dice: '2d6' | '1d6'): RollResult {
  const n = dice === '2d6' ? 2 : 1;
  const dieValues: number[] = [];
  for (let i = 0; i < n; i++) dieValues.push(d6At(seed, cursor + i));
  return { result: dieValues.reduce((a, b) => a + b, 0), dieValues, nextCursor: cursor + n };
}

/**
 * Pure hash for non-dice randomness (GHOST scatter, D-008.4). Returns [0, mod).
 * Does NOT consume seedCursor — the cursor is reserved for dice (D-004).
 */
export function hashPick(seed: string, parts: (string | number)[], mod: number): number {
  let h = seedToBigint(seed + '|' + parts.join('|'));
  h = splitmix64(h);
  return Number(h % BigInt(mod));
}
