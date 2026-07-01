/**
 * Integration test against the bundled MegaMek library. Skips automatically when
 * the library hasn't been extracted/built (e.g. CI before `extract-units`), so it
 * never breaks a clean checkout; run `npm run build:battle` (or extract-units) to
 * exercise it locally.
 */
import { describe, expect, it } from 'vitest';
import { deriveFieldsForModel, isLibraryAvailable, loadCardByModel } from '../../src/roster/library.js';

const has = isLibraryAvailable();

describe.skipIf(!has)('roster/library — real record sheets', () => {
  it('derives classic movement + BV for a known BattleMech', () => {
    const d = deriveFieldsForModel('Warhammer WHM-6R')!;
    expect(d.class).toBe('MECH');
    expect([d.walkOrCruise, d.run]).toEqual([4, 6]);
    expect(d.bv).toBeGreaterThan(0);
  });

  it('tags a unit that mounts Guardian ECM', () => {
    const card = loadCardByModel('Warhammer WHM-6R'); // sanity: loader returns raw text
    expect(card?.text).toBeTypeOf('string');
    // the Akuma AKU-2XK mounts a Guardian ECM Suite
    const ecm = deriveFieldsForModel('Akuma AKU-2XK')!;
    expect(ecm.tags).toContain('ECM');
  });

  it('returns null for a model with no library match', () => {
    expect(deriveFieldsForModel('Definitely Not A Real Mech ZZ-9')).toBeNull();
  });
});

describe.skipIf(has)('roster/library — no library present', () => {
  it('degrades to null so callers keep their own data', () => {
    expect(deriveFieldsForModel('Warhammer WHM-6R')).toBeNull();
  });
});
