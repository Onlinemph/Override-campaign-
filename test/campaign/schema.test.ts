/** M6+ — campaign authoring: the validator and the newly-wired fixture fields. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCampaign } from '../../src/campaign/schema.js';
import { buildCampaign, loadCampaignFixture } from '../../src/demo.js';

const demo = () => JSON.parse(readFileSync(join(__dirname, '../../demo/campaign.json'), 'utf8'));

/** A minimal but complete valid campaign, used as a clean base to corrupt per-test. */
function minimal(): any {
  return {
    seed: 'TEST',
    config: { name: 'Test', dawnTick: 60, duskTick: 180, weather: 'CLEAR' },
    theaters: [{ id: 't1', name: 'T1', width: 10, height: 10, defaultTerrain: 'CLEAR', overrides: [] }],
    sides: [{ id: 'blue', name: 'Blue' }, { id: 'red', name: 'Red' }],
    facilities: [], satellites: [], formations: [
      { id: 'blue-1', sideId: 'blue', theaterId: 't1', q: 1, r: 1, sigBase: 7,
        units: [{ name: 'A', model: 'X', class: 'MECH' }] },
    ],
    commandNodes: { blue: ['blue-1'], red: [] }, orders: [],
  };
}

describe('validator — the shipped demo is valid', () => {
  it('demo/campaign.json passes with zero problems', () => {
    expect(validateCampaign(demo())).toEqual([]);
  });
  it('demo/starter.json passes and builds', () => {
    const starter = JSON.parse(readFileSync(join(__dirname, '../../demo/starter.json'), 'utf8'));
    expect(validateCampaign(starter)).toEqual([]);
    expect(() => buildCampaign(starter, 'starter')).not.toThrow();
  });
});

describe('loader — optional sections may be omitted entirely', () => {
  it('builds with no facilities / satellites / orders / commandNodes / markers', () => {
    const j = minimal();
    delete j.facilities; delete j.satellites; delete j.orders;
    delete j.commandNodes; delete j.markers;
    expect(validateCampaign(j)).toEqual([]);
    let truth: any;
    expect(() => { truth = buildCampaign(j, 'minimal'); }).not.toThrow();
    expect(Object.keys(truth.formations)).toEqual(['blue-1']);
    expect(truth.sides.blue.commandNodes).toEqual([]); // defaulted, not crashed
  });
});

describe('validator — catches authoring mistakes with readable messages', () => {
  const expectProblem = (mutate: (j: any) => void, needle: string) => {
    const j = minimal();
    mutate(j);
    const problems = validateCampaign(j);
    expect(problems.some(p => p.toLowerCase().includes(needle.toLowerCase())),
      `expected a problem mentioning "${needle}", got: ${JSON.stringify(problems)}`).toBe(true);
  };

  it('missing seed / config / theaters / sides', () => {
    expectProblem(j => delete j.seed, 'seed');
    expectProblem(j => delete j.config, 'config');
    expectProblem(j => { j.theaters = []; }, 'theaters');
    expectProblem(j => { j.sides = []; }, 'sides');
  });
  it('bad enums (terrain, unit class, emcon, weather)', () => {
    expectProblem(j => { j.theaters[0].defaultTerrain = 'LAVA'; }, 'defaultTerrain');
    expectProblem(j => { j.formations[0].units[0].class = 'TANK'; }, 'bad class');
    expectProblem(j => { j.formations[0].emcon = 'LOUD'; }, 'bad emcon');
    expectProblem(j => { j.config.weather = 'SNOW'; }, 'weather');
  });
  it('dangling references (side, theater, node, formation, command node)', () => {
    expectProblem(j => { j.formations[0].sideId = 'green'; }, 'unknown side');
    expectProblem(j => { j.facilities.push({ id: 'f', sideId: 'blue', theaterId: 'nope', q: 0, r: 0 }); }, 'unknown theater');
    expectProblem(j => { j.formations.push({ id: 'v', sideId: 'red', nodeId: 'ghost', units: [{ name: 'a', model: 'b', class: 'DROPSHIP' }] }); }, 'unknown node');
    expectProblem(j => { j.orders.push({ id: 'o', sideId: 'blue', formationId: 'nope', kind: 'MOVE' }); }, 'unknown formation');
    expectProblem(j => { j.commandNodes.blue = ['who']; }, 'not a facility or formation');
  });
  it('geometry errors (out of bounds, two positions, bad order kind)', () => {
    expectProblem(j => { j.formations[0].q = 99; }, 'outside theater');
    expectProblem(j => { j.formations[0].nodeId = 'x'; }, 'more than one position');
    expectProblem(j => { j.orders.push({ id: 'o', sideId: 'blue', formationId: 'blue-1', kind: 'FLY' }); }, 'bad kind');
  });
  it('duplicate ids and out-of-range numbers', () => {
    expectProblem(j => { j.sides.push({ id: 'blue', name: 'Dup' }); }, 'duplicate side');
    expectProblem(j => { j.formations[0].rdy = 11; }, 'rdy must be 0');
    expectProblem(j => { j.formations[0].units[0].pilot = { name: 'Ace', gunnery: 12 }; }, 'gunnery');
    expectProblem(j => { j.formations[0].units[0].drive = { chargePct: 150 }; }, 'chargePct');
  });
});

describe('loader — friendly aggregated error on invalid input', () => {
  it('buildCampaign throws listing every problem', () => {
    const j = minimal();
    j.formations[0].sideId = 'green';
    j.formations[0].q = 99;
    expect(() => buildCampaign(j, 'mine.json')).toThrow(/mine\.json has 2 problem/);
  });
});

describe('loader — the newly-wired authoring fields actually load', () => {
  it('side VP, formation posture/rdy, unit damage/ammo, rich pilots, drives, markers', () => {
    const j = minimal();
    j.sides[0].vp = 7;
    j.formations[0].posture = 'DUG_IN';
    j.formations[0].rdy = 6;
    j.formations[0].units[0].damage = 'DAMAGED';
    j.formations[0].units[0].ammoState = 'PARTIAL';
    j.formations[0].units[0].pilot = { name: 'Natasha', gunnery: 2, piloting: 3, ace: true, kills: 9 };
    // a jump-capable vessel with a charging drive
    j.system = { nodes: [{ id: 'zenith', type: 'JUMP_ZENITH', name: 'Zenith' }], lanes: [] };
    j.formations.push({ id: 'js', sideId: 'red', nodeId: 'zenith', sigBase: 8,
      units: [{ name: 'Invader', model: 'Invader', class: 'JUMPSHIP',
        drive: { chargePct: 50, sail: 'DEPLOYED' } }] });
    j.markers = [{ id: 'mf', kind: 'MINEFIELD', theaterId: 't1', q: 5, r: 5, sideId: 'blue' }];

    const t = buildCampaign(j);
    expect(t.sides.blue.vp).toBe(7);
    const f = t.formations['blue-1'];
    expect(f.posture).toBe('DUG_IN');
    expect(f.rdy).toBe(6);
    expect(t.units['blue-1-u1'].damage).toBe('DAMAGED');
    expect(t.units['blue-1-u1'].ammoState).toBe('PARTIAL');
    const pilot = t.pilots[t.units['blue-1-u1'].pilotIds[0]];
    expect(pilot).toMatchObject({ name: 'Natasha', gunnery: 2, piloting: 3, ace: true, kills: 9 });
    expect(t.jumpDrives['js-u1']).toMatchObject({ chargePct: 50, sail: 'DEPLOYED' });
    expect(t.markers['mf']).toMatchObject({ kind: 'MINEFIELD', sideId: 'blue' });
    expect((t.markers['mf'].pos as any)).toMatchObject({ kind: 'ground', q: 5, r: 5 });
  });

  it('a bare pilot name still loads as a regular 4/5 crew (back-compat)', () => {
    const j = minimal();
    j.formations[0].units[0].pilot = 'Joe';
    const t = buildCampaign(j);
    const pilot = t.pilots[t.units['blue-1-u1'].pilotIds[0]];
    expect(pilot).toMatchObject({ name: 'Joe', gunnery: 4, piloting: 5, ace: false });
  });

  it('the demo file round-trips through the full loader', () => {
    expect(() => loadCampaignFixture(join(__dirname, '../../demo/campaign.json'))).not.toThrow();
  });
});

describe('validator & loader — carriers and embarked formations', () => {
  const withCarrier = () => {
    const j = minimal();
    j.formations.push(
      { id: 'ds1', sideId: 'blue', theaterId: 't1', q: 2, r: 2, sigBase: 8,
        carrier: { bays: 2, crews: 1, avFuelTons: 40 },
        units: [{ name: 'Union', model: 'Union', class: 'DROPSHIP' }] },
      { id: 'cargo', sideId: 'blue', theaterId: 't1', q: 2, r: 2, sigBase: 7,
        mountedOn: 'ds1',
        units: [{ name: 'Wasp', model: 'Wasp WSP-1A', class: 'MECH' }] });
    return j;
  };

  it('a valid carrier + embarked formation passes and builds', () => {
    const j = withCarrier();
    expect(validateCampaign(j)).toEqual([]);
    const t = buildCampaign(j);
    expect(t.formations['ds1'].carrier).toMatchObject({ bays: 2, crews: 1, avFuelTons: 40 });
    expect(t.formations['cargo'].mounted).toEqual({ carrierFormationId: 'ds1' });
  });

  it('catches carrier authoring mistakes with readable messages', () => {
    const expectProblem = (mutate: (j: any) => void, needle: string) => {
      const j = withCarrier();
      mutate(j);
      const problems = validateCampaign(j);
      expect(problems.some(p => p.toLowerCase().includes(needle.toLowerCase())),
        `expected a problem mentioning "${needle}", got: ${JSON.stringify(problems)}`).toBe(true);
    };
    expectProblem(j => { j.formations[2].mountedOn = 'nope'; }, 'unknown formation');
    expectProblem(j => { j.formations[2].mountedOn = 'cargo'; }, 'itself');
    expectProblem(j => { j.formations[2].mountedOn = 'blue-1'; }, 'not a carrier');
    expectProblem(j => { j.formations[1].sideId = 'red'; }, 'other side');
    expectProblem(j => { j.formations[1].carrier.bays = 0; }, 'bays');
    expectProblem(j => { j.formations[1].carrier.avFuelTons = -1; }, 'avFuelTons');
    // more embarked than bays
    expectProblem(j => {
      j.formations[1].carrier.bays = 1;
      j.formations.push({ id: 'cargo2', sideId: 'blue', theaterId: 't1', q: 2, r: 2,
        sigBase: 7, mountedOn: 'ds1', units: [{ name: 'B', model: 'X', class: 'MECH' }] });
    }, 'only 1 bays');
    // carriers don't nest
    expectProblem(j => {
      j.formations[2].carrier = { bays: 1, crews: 0, avFuelTons: 0 };
      j.formations.push({ id: 'nested', sideId: 'blue', theaterId: 't1', q: 2, r: 2,
        sigBase: 7, mountedOn: 'cargo', units: [{ name: 'C', model: 'X', class: 'MECH' }] });
    }, 'nest');
  });
});
