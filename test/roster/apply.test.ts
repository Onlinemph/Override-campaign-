import { describe, expect, it } from 'vitest';
import { buildUnitFromModel, enrichTruth, enrichUnit } from '../../src/roster/apply.js';
import { isLibraryAvailable } from '../../src/roster/library.js';
import { formationSensors } from '../../src/engine/detection.js';
import { addFormation, mkFormation, mkUnit } from '../../src/fixtures.js';
import { baseTruth, gp } from '../helpers.js';
import type { Unit } from '../../src/core/types.js';

const has = isLibraryAvailable();

describe.skipIf(!has)('roster/apply — author from a model name', () => {
  it('mints a fully-populated unit with derived class / movement / tags / BV', () => {
    const u = buildUnitFromModel({ id: 'u1', sideId: 'blue', model: 'Akuma AKU-2XK' })!;
    expect(u.class).toBe('MECH');
    expect(u.walkOrCruise).toBeGreaterThan(0);
    expect(u.tags).toContain('ECM');
    expect(u.bv).toBeGreaterThan(0);
    expect(u.damage).toBe('OK');
    expect(u.ammoState).toBe('FULL');
  });

  it('returns null for an unresolvable model', () => {
    expect(buildUnitFromModel({ id: 'x', sideId: 'blue', model: 'Nope NO-1' })).toBeNull();
  });
});

describe.skipIf(!has)('roster/apply — enrich (explicit values win)', () => {
  const mkBare = (over: Partial<Unit>): Unit => ({
    id: 'e1', sideId: 'blue', name: 'Scout', model: 'Antlion LK-3D', class: 'MECH',
    bv: 0, pv: 0, walkOrCruise: 0, run: 0, jump: 0, damage: 'OK', pilotIds: [],
    ammoState: 'FULL', tags: [], ...over,
  });

  it('fills unset movement + BV and unions the derived probe tag', () => {
    const u = mkBare({ tags: ['RECON'] }); // hand-authored mission tag
    const changed = enrichUnit(u);
    expect(u.walkOrCruise).toBeGreaterThan(0);
    expect(u.bv).toBeGreaterThan(0);
    expect(u.tags).toEqual(expect.arrayContaining(['RECON', 'BEAGLE'])); // both kept/added
    expect(changed).toEqual(expect.arrayContaining(['walkOrCruise', 'bv', 'tags']));
  });

  it('never overwrites a movement value the GM already set', () => {
    const u = mkBare({ walkOrCruise: 9 }); // deliberate house-rule speed
    const changed = enrichUnit(u);
    expect(u.walkOrCruise).toBe(9);          // kept
    expect(changed).not.toContain('walkOrCruise');
  });
});

describe.skipIf(!has)('roster/apply — the payoff: derived gear changes the map', () => {
  it('a derived Beagle probe extends the formation sensor range (3/5 vs 2/4)', () => {
    const truth = baseTruth('SENSOR-DERIVE');

    // plain 'Mech: standard sensors
    const plain = mkUnit({ id: 'p1', sideId: 'blue', name: 'Line', model: 'Warhammer WHM-6R' });
    const plainF = mkFormation({ id: 'plain', sideId: 'blue', name: 'Line', pos: gp(5, 5) });
    addFormation(truth, plainF, [plain]);
    expect(formationSensors(truth, truth.formations['plain'])).toEqual({ passive: 2, active: 4 });

    // scout authored from a real probe 'Mech: enhanced sensors, automatically
    const scout = buildUnitFromModel({ id: 's1', sideId: 'blue', model: 'Antlion LK-3D' })!;
    expect(scout.tags).toContain('BEAGLE');
    const scoutF = mkFormation({ id: 'scout', sideId: 'blue', name: 'Scout', pos: gp(6, 5) });
    addFormation(truth, scoutF, [scout]);
    expect(formationSensors(truth, truth.formations['scout'])).toEqual({ passive: 3, active: 5 });
  });
});

describe('roster/apply — enrichTruth reports library availability', () => {
  it('summarizes changes (or a clean no-op without a library)', () => {
    const truth = baseTruth('ENRICH-SUMMARY');
    const u = mkUnit({ id: 'z1', sideId: 'blue', name: 'Z', model: 'Warhammer WHM-6R' });
    const f = mkFormation({ id: 'zf', sideId: 'blue', name: 'Z', pos: gp(1, 1) });
    addFormation(truth, f, [u]);
    const summary = enrichTruth(truth);
    expect(summary.available).toBe(has);
    if (has) expect(summary.unitsChanged).toBeGreaterThanOrEqual(0);
    else expect(summary.unitsChanged).toBe(0);
  });
});
