/** M5 — MegaMek .mul export and the GM noise tools. */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { buildMul } from '../../src/handoff/mul.js';
import { project } from '../../src/projection/project.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

function frozenCampaign(): Campaign {
  const truth = baseTruth('MUL-SEED');
  truth.clockMode = 'CONTACT';
  const red = addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(5, 5) },
    2, { model: 'Warhammer WHM-6R' });
  truth.pilots['ace'] = { id: 'ace', name: 'Natasha "Black Widow"', gunnery: 2, piloting: 3,
                          kills: 9, ace: true, fatigue: 0, status: 'OK' };
  truth.units[red.unitIds[0]].pilotIds = ['ace'];
  const blue = addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(6, 5), omp: 4 },
    1, { model: 'Atlas AS7-D' });
  truth.orders['o'] = moveOrder('o', blue, 'MOVE', [gp(5, 5)]);
  blue.currentOrderId = 'o';
  const c = Campaign.create(truth);
  let guard = 0;
  while (!c.pendingEngagement && guard++ < 5) c.step();
  return c;
}

describe('M5 — MegaMek export', () => {
  it('emits a per-side .mul with chassis/model split, crew skills, and setup notes', () => {
    const c = frozenCampaign();
    const pkg = c.exportHandoff()!;
    const xml = buildMul(c.truth, pkg, 'red');
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<entity chassis="Warhammer" model="WHM-6R">');
    expect(xml).toContain('name="Natasha &quot;Black Widow&quot;" gunnery="2" piloting="3"');
    expect(xml).toContain('gunnery="4" piloting="5"'); // the default crew on ship 2
    expect(xml).toContain('<unit version="1.0">');
    expect(xml).toContain('side red');
    expect((xml.match(/<entity /g) ?? []).length).toBe(2);

    const blueXml = buildMul(c.truth, pkg, 'blue');
    expect(blueXml).toContain('chassis="Atlas" model="AS7-D"');
    expect(() => buildMul(c.truth, pkg, 'green')).toThrow();
  });
});

describe('M5 — the noise editor', () => {
  it('REPORT_EDITED rewrites an undelivered report, survives replay, and the player gets the lie', () => {
    const truth = baseTruth('NOISE-SEED');
    addMechFormation(truth, { id: 'hq', sideId: 'blue', pos: gp(0, 0) });
    truth.sides['blue'].commandNodes = ['hq'];
    const scout = addMechFormation(truth, { id: 'scout', sideId: 'blue', pos: gp(20, 0) });
    const c = Campaign.create(truth);
    c.inject({ type: 'REPORT_QUEUED', report: {
      id: 'r1', sideId: 'blue', generatedTick: 5, deliveredTick: null,
      sourceFormationId: 'scout', contactId: 'cx',
      text: 'SHADOW, company-strength armor, hex 12,4',
      snapshot: { level: 2, estPos: gp(12, 4), posErrorHexes: 0, asOfTick: 5 } } });

    // the GM injects static before the courier gets home
    c.inject({ type: 'REPORT_EDITED', reportId: 'r1',
               text: 'SHADOW, BATTALION-strength armor, hex 12,4 — confidence low, storm static' });

    // courier comes home; the edited text is what lands in the inbox
    c.inject({ type: 'FORMATION_MOVED', formationId: 'scout', to: gp(5, 0),
               movedKind: 'NORMAL', onRoad: false, headingDeg: 180, tick: c.truth.tick });
    for (let i = 0; i < 4 && !c.truth.reports['r1'].deliveredTick; i++) c.step();
    expect(c.truth.reports['r1'].deliveredTick).not.toBeNull();
    const v = project(c.truth, 'blue', c.truth.tick);
    expect(v.reports.some(r => r.text.includes('BATTALION-strength') &&
                               r.text.includes('storm static'))).toBe(true);
    expect(JSON.stringify(v)).not.toContain('company-strength');

    expect(replay(c.store.all())).toEqual(c.truth); // the lie is in the log too
    void scout;
  });
});

describe('M5 — map data in the view (leak checks)', () => {
  function scenario(): TruthState {
    const truth = baseTruth('MAPDATA-SEED');
    addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(5, 5) });
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(20, 5) });
    truth.facilities['blue-base'] = {
      id: 'blue-base', sideId: 'blue', name: 'Firebase Alpha', pos: gp(4, 5),
      tags: ['DEPOT'], fuelFarmTons: 12, supplyPoints: 30,
      turnaroundCrews: { total: 1, busyUntil: [] }, isCommandNode: true,
    };
    truth.satellites['blue-sat'] = {
      id: 'blue-sat', sideId: 'blue', kind: 'RECON', theaterId: 'theater-1',
      corridor: [{ q: 0, r: 8 }, { q: 29, r: 8 }], periodPulses: 4,
      nextPassTick: 40, alive: true, knownTo: ['blue', 'red'], // red witnessed the launch
    };
    truth.satellites['blue-sat-secret'] = {
      id: 'blue-sat-secret', sideId: 'blue', kind: 'COMM', theaterId: 'theater-1',
      corridor: [], periodPulses: 4, nextPassTick: 0, alive: true, knownTo: ['blue'],
    };
    return truth;
  }

  it('own facilities & satellites are visible; theater bounds are public geography', () => {
    const v = project(scenario(), 'blue', 0);
    expect(v.ownFacilities.map(f => f.id)).toEqual(['blue-base']);
    expect(v.ownFacilities[0].fuelFarmTons).toBe(12);
    expect(v.ownSatellites.map(s => s.id).sort()).toEqual(['blue-sat', 'blue-sat-secret']);
    expect(v.theaters[0]).toMatchObject({ id: 'theater-1', cols: 30, rows: 20 });
  });

  it('the enemy sees a witnessed satellite (schedule around it!) but never your facilities', () => {
    const v = project(scenario(), 'red', 0);
    expect(v.ownFacilities).toHaveLength(0);
    expect(JSON.stringify(v)).not.toContain('Firebase Alpha');
    expect(JSON.stringify(v)).not.toContain('fuelFarmTons":12');
    // core §8.6: spotting the satellite lets you schedule around its passes
    expect(v.ownSatellites.map(s => s.id)).toEqual(['blue-sat']);
    expect(JSON.stringify(v)).not.toContain('blue-sat-secret');
  });
});
