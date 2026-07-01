import { describe, expect, it } from 'vitest';
import { campaignUnitsFromForce, rollForce, weightClass } from '../../src/roster/roll.js';
import { isLibraryAvailable } from '../../src/roster/library.js';

const has = isLibraryAvailable();

describe('weightClass', () => {
  it('bands tonnage into the four MechWarrior weight classes', () => {
    expect(weightClass(30)).toBe('LIGHT');
    expect(weightClass(45)).toBe('MEDIUM');
    expect(weightClass(70)).toBe('HEAVY');
    expect(weightClass(100)).toBe('ASSAULT');
  });
});

describe('campaignUnitsFromForce', () => {
  it('converts a card-builder force, carrying pilot skills', () => {
    const specs = campaignUnitsFromForce({ units: [{ name: 'X', gunnery: 2, piloting: 3 }] });
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ name: 'X', model: 'X', gunnery: 2, piloting: 3 });
    expect(specs[0].class).toBeTruthy();
  });
  it('handles an empty/missing force', () => {
    expect(campaignUnitsFromForce(null)).toEqual([]);
    expect(campaignUnitsFromForce({})).toEqual([]);
  });
});

describe.skipIf(!has)('rollForce — from the real library', () => {
  it('rolls the requested count of the requested class + weight', () => {
    const lance = rollForce({ count: 4, seed: 'unit-test', classes: ['MECH'], weight: 'MEDIUM' });
    expect(lance).toHaveLength(4);
    expect(lance.every(u => u.class === 'MECH')).toBe(true);
    expect(lance.every(u => u.tonnage !== undefined && weightClass(u.tonnage) === 'MEDIUM')).toBe(true);
  });

  it('is reproducible for a given seed', () => {
    const a = rollForce({ count: 3, seed: 'same', classes: ['MECH'] });
    const b = rollForce({ count: 3, seed: 'same', classes: ['MECH'] });
    expect(a.map(u => u.model)).toEqual(b.map(u => u.model));
  });

  it('honours a BV ceiling', () => {
    const light = rollForce({ count: 3, seed: 'bv', classes: ['MECH'], maxBv: 1000 });
    expect(light.every(u => (u.bv ?? 0) <= 1000)).toBe(true);
  });
});

describe.skipIf(has)('rollForce — no library', () => {
  it('returns nothing so callers degrade', () => {
    expect(rollForce({ count: 4 })).toEqual([]);
  });
});
