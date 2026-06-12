/** B9 — projection purity & no-leak guarantees (spec §0, §4). */
import { describe, expect, it } from 'vitest';
import { project } from '../../src/projection/project.js';
import { addMechFormation, baseTruth, gp } from '../helpers.js';
import type { ContactSnapshot, TruthState } from '../../src/core/types.js';

function scenario(): TruthState {
  const truth = baseTruth('PROJ-SEED', [
    { q: 3, r: 10, infra: ['SPACEPORT'], objective: { vpPerDay: 3, hidden: false } },
    { q: 18, r: 11, objective: { vpPerDay: 2, hidden: true } },
  ]);
  truth.tick = 120;
  const own = addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(5, 5) });
  own.onNet = true;
  addMechFormation(truth, { id: 'red-secret', sideId: 'red', pos: gp(20, 5) },
    4, { name: 'Crimson Reaper', model: 'ATLAS-AS7-D' });
  truth.sides['blue'].vp = 7;
  truth.scoutedHexes['blue'] = ['theater-1:3,10', 'theater-1:18,11', 'theater-1:5,5'];
  return truth;
}

function snap(level: 1 | 2 | 3 | 4, asOfTick = 100): ContactSnapshot {
  const s: ContactSnapshot = {
    level, estPos: gp(19, 5), posErrorHexes: level === 1 ? 1 : 0, asOfTick,
  };
  if (level >= 2) { s.estVector = 240; s.estSizeClass = 'lance'; }
  if (level >= 3) s.estComposition = '4×MECH';
  if (level >= 4) s.toe = [{ name: 'Crimson Reaper', model: 'ATLAS-AS7-D',
                             damage: 'OK', ammoState: 'FULL', emcon: 'PASSIVE' }];
  return s;
}

function withContact(truth: TruthState, level: 1 | 2 | 3 | 4, delivered: boolean): void {
  truth.contacts['c1'] = {
    id: 'c1', observerSideId: 'blue', targetFormationId: 'red-secret', kind: 'STANDARD',
    level: 4, // truth-side ladder may be higher than what was delivered
    lastConfirmedTick: 110, lastFadeTick: 110,
    estPos: gp(20, 5), posErrorHexes: 0, staleAsOfTick: 110,
    delivered: delivered ? snap(level) : undefined,
  };
}

describe('B9 — projection', () => {
  it('own formations are fully visible with ledgers', () => {
    const v = project(scenario(), 'blue', 120);
    expect(v.ownFormations).toHaveLength(1);
    const f = v.ownFormations[0];
    expect(f.id).toBe('blue-1');
    expect(f.pos).toEqual(gp(5, 5));
    expect(f.rdy).toBe(10);
    expect(f.units).toHaveLength(4);
    expect(v.vp).toBe(7);
  });

  it('enemy formations are completely absent without a delivered contact', () => {
    const truth = scenario();
    const v = project(truth, 'blue', 120);
    expect(v.contacts).toHaveLength(0);
    expect(JSON.stringify(v)).not.toContain('red-secret');
    expect(JSON.stringify(v)).not.toContain('Crimson Reaper');
    expect(JSON.stringify(v)).not.toContain('"q":20'); // no true position anywhere
  });

  it('an UNDELIVERED contact (scout still off-net) shows nothing, whatever truth knows', () => {
    const truth = scenario();
    withContact(truth, 3, false);
    const v = project(truth, 'blue', 120);
    expect(v.contacts).toHaveLength(0);
  });

  it('spec §4 reveal table: GHOST shows position-only at ±1', () => {
    const truth = scenario();
    withContact(truth, 1, true);
    const [c] = project(truth, 'blue', 120).contacts;
    expect(c.levelName).toBe('GHOST');
    expect(c.posErrorHexes).toBe(1);
    expect(c.estVector).toBeUndefined();
    expect(c.estSizeClass).toBeUndefined();
    expect(c.estComposition).toBeUndefined();
    expect(c.toe).toBeUndefined();
    expect(c.staleAsOfTick).toBe(100);
    expect(c.ageTicks).toBe(20);
  });

  it('spec §4 reveal table: SHADOW adds vector + size class', () => {
    const truth = scenario();
    withContact(truth, 2, true);
    const [c] = project(truth, 'blue', 120).contacts;
    expect(c.estVector).toBe(240);
    expect(c.estSizeClass).toBe('lance');
    expect(c.estComposition).toBeUndefined();
    expect(c.toe).toBeUndefined();
  });

  it('spec §4 reveal table: CONTACT adds composition; LOCK adds full TO&E', () => {
    const truth = scenario();
    withContact(truth, 3, true);
    expect(project(truth, 'blue', 120).contacts[0].estComposition).toBe('4×MECH');
    expect(project(truth, 'blue', 120).contacts[0].toe).toBeUndefined();

    withContact(truth, 4, true);
    const [lock] = project(truth, 'blue', 120).contacts;
    expect(lock.toe).toEqual(snap(4).toe);
  });

  it('view renders the DELIVERED level even when the truth ladder is higher (D-008.5)', () => {
    const truth = scenario();
    withContact(truth, 1, true); // truth knows LOCK; only a GHOST report was delivered
    const [c] = project(truth, 'blue', 120).contacts;
    expect(c.level).toBe(1);
    expect(JSON.stringify(c)).not.toContain('red-secret'); // contact id only, never target id
  });

  it('reports inbox: delivered only, sorted; undelivered & lost reports invisible', () => {
    const truth = scenario();
    const mk = (id: string, deliveredTick: number | null, lost = false) => ({
      id, sideId: 'blue', generatedTick: 50, deliveredTick,
      sourceFormationId: 'blue-1', contactId: 'c1', text: `report ${id}`,
      snapshot: snap(1), lost,
    });
    truth.reports['r-late'] = mk('r-late', 90);
    truth.reports['r-early'] = mk('r-early', 60);
    truth.reports['r-held'] = mk('r-held', null);
    truth.reports['r-lost'] = mk('r-lost', null, true);
    const v = project(truth, 'blue', 120);
    expect(v.reports.map(r => r.id)).toEqual(['r-early', 'r-late']);
    expect(v.reports[0].generatedTick).toBe(50);
  });

  it('reports for the other side are never visible', () => {
    const truth = scenario();
    truth.reports['red-r'] = {
      id: 'red-r', sideId: 'red', generatedTick: 50, deliveredTick: 60,
      sourceFormationId: 'red-secret', contactId: 'cx', text: 'red intel',
      snapshot: snap(1),
    };
    expect(project(truth, 'blue', 120).reports).toHaveLength(0);
  });

  it('scouted terrain only; hidden objectives stay hidden (D-008.12)', () => {
    const v = project(scenario(), 'blue', 120);
    expect(v.scoutedTerrain).toHaveLength(3);
    const spaceport = v.scoutedTerrain.find(h => h.q === 3 && h.r === 10)!;
    expect(spaceport.objective).toEqual({ vpPerDay: 3 });
    const hiddenHex = v.scoutedTerrain.find(h => h.q === 18 && h.r === 11)!;
    expect(hiddenHex.objective).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain('hidden');
  });

  it('never leaks the RNG: no seed, no cursor in any view', () => {
    const truth = scenario();
    withContact(truth, 4, true);
    const json = JSON.stringify(project(truth, 'blue', 120));
    expect(json).not.toContain('PROJ-SEED');
    expect(json).not.toContain('seedCursor');
    expect(json).not.toContain('campaignSeed');
  });

  it('is pure: projecting mutates nothing', () => {
    const truth = scenario();
    withContact(truth, 2, true);
    const before = structuredClone(truth);
    project(truth, 'blue', 120);
    project(truth, 'red', 120);
    expect(truth).toEqual(before);
  });

  it('symmetric: red view shows red things and no blue things', () => {
    const truth = scenario();
    withContact(truth, 3, true);
    const v = project(truth, 'red', 120);
    expect(v.ownFormations.map(f => f.id)).toEqual(['red-secret']);
    expect(v.contacts).toHaveLength(0);
    expect(JSON.stringify(v)).not.toContain('blue-1');
  });
});
