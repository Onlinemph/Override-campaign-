/** GM reinforcement: spawn a formation into a running campaign (logged, replay-safe). */
import { describe, expect, it } from 'vitest';
import { Campaign } from '../../src/core/truth.js';
import { buildFormationEntities } from '../../src/demo.js';
import { addMechFormation, baseTruth, gp, T } from '../helpers.js';
import type { TruthState } from '../../src/core/types.js';

function scenario(): TruthState {
  const truth = baseTruth('SPAWN-SEED');
  const hq = addMechFormation(truth, { id: 'blue-hq', sideId: 'blue', pos: gp(2, 2) });
  truth.sides['blue'].commandNodes = [hq.id];
  return truth;
}

const spec = {
  id: 'relief', sideId: 'blue', name: 'Relief Company', theaterId: T, q: 4, r: 4,
  sigBase: 6, omp: 4,
  units: [
    { name: 'Vixen 1', model: 'Stinger STG-3R', class: 'MECH', pilot: { gunnery: 3, piloting: 4 } },
    { name: 'Vixen 2', model: 'Wasp WSP-1A', class: 'MECH' },
  ],
};

describe('GM reinforcement — spawnFormation', () => {
  it('buildFormationEntities yields a formation with unitIds populated', () => {
    const { formation, units, pilots } = buildFormationEntities(spec);
    expect(units.map(u => u.id)).toEqual(['relief-u1', 'relief-u2']);
    expect(formation.unitIds).toEqual(['relief-u1', 'relief-u2']); // FORMATION_SPAWNED needs this
    expect(pilots).toHaveLength(1);
    expect(units[0].pilotIds).toEqual([pilots[0].id]);
  });

  it('spawns into a live campaign — units, pilots, and the formation all land', () => {
    const c = Campaign.create(scenario());
    for (let i = 0; i < 3; i++) c.step();
    const before = Object.keys(c.truth.formations).length;

    const { formation, units, pilots, jumpDrives } = buildFormationEntities(spec);
    c.spawnFormation(formation, units, pilots, jumpDrives);

    expect(Object.keys(c.truth.formations).length).toBe(before + 1);
    expect(c.truth.formations['relief'].name).toBe('Relief Company');
    expect(c.truth.formations['relief'].unitIds).toEqual(['relief-u1', 'relief-u2']);
    expect(c.truth.units['relief-u1'].model).toBe('Stinger STG-3R');
    expect(c.truth.pilots['relief-pilot-1'].gunnery).toBe(3);
  });

  it('the spawn is replay-safe: a fresh replay reproduces the same truth', () => {
    const c = Campaign.create(scenario());
    c.step();
    const { formation, units, pilots, jumpDrives } = buildFormationEntities(spec);
    c.spawnFormation(formation, units, pilots, jumpDrives);
    for (let i = 0; i < 4; i++) c.step(); // the reinforcement participates in subsequent ticks

    const replayed = Campaign.fromStore(c.store);
    expect(replayed.truth).toEqual(c.truth);
  });
});
