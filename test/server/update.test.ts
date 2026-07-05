/** D-054.1 — the update beacon's version arithmetic. */
import { describe, expect, it } from 'vitest';
import { cmpVersions } from '../../src/server/update.js';

describe('cmpVersions', () => {
  it('orders semantic versions numerically, not lexically', () => {
    expect(cmpVersions('0.2.0', '0.1.0')).toBeGreaterThan(0);
    expect(cmpVersions('0.1.10', '0.1.9')).toBeGreaterThan(0); // 10 > 9, not '1' < '9'
    expect(cmpVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(cmpVersions('0.1.0', '0.1.0')).toBe(0);
    expect(cmpVersions('0.1', '0.1.0')).toBe(0);   // missing segments are zero
    expect(cmpVersions('0.1.0', '0.2.0')).toBeLessThan(0);
  });
});
