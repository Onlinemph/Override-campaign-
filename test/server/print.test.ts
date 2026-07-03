/** The paper bridge (ext, D-034): the battle pack prints the truth, legibly. */
import { describe, expect, it } from 'vitest';
import { buildBattlePack, describeSheetDamage } from '../../src/server/print.js';
import type { BattleRoster } from '../../src/handoff/battle.js';

const roster: BattleRoster = {
  handoffId: 'handoff:eng:100:g:5,5',
  tick: 730, // Day 4, 01:00
  table: 'GROUND',
  specialRules: ['HIDDEN_SETUP', 'FORTIFIED'],
  mapSheets: ['WOODS', 'CLEAR'],
  sides: [
    { sideId: 'blue', name: 'Cavanaugh <Lancers>', units: [
        { unitId: 'u1', pilotIds: ['p1'], model: 'Atlas AS7-D', pilot: 'Cpt. Reyes',
          gunnery: 3, piloting: 4, damage: 'DAMAGED', ammoState: 'PARTIAL',
          sheetDamage: { loc: { LA: 4, CT: 2 }, engine: 1, heat: 3,
                         ammo: { 'LRM 20': 6 }, condition: 1 } },
        { unitId: 'u2', pilotIds: [], model: 'Wolfhound WLF-1',
          gunnery: 4, piloting: 5, damage: 'OK', ammoState: 'FULL' },
      ],
      setup: { entryEdge: 'NW', deploysFirst: false, initiativeBonus: 2,
        initiativeBonusTurns: 3, hiddenSetup: false, fortified: false, rdyTnPenalty: 1,
        offboard: { artillery: 2, reinforcements: [{ arrivesTurn: 4, edge: 'ANY_HALF' }],
                    airOnStation: [{ arrivesTurn: 0, fpOnStation: 12 }] } } },
    { sideId: 'red', name: 'Sword of Light', units: [
        { unitId: 'u3', pilotIds: ['p3'], model: 'Dragon DRG-1N', pilot: 'Tai-i Mori',
          gunnery: 4, piloting: 4, damage: 'OK', ammoState: 'FULL',
          velocity: 2, altLevel: 6, fpOnTable: 44, jokerFp: 20, bingoFp: 10 },
      ],
      setup: { entryEdge: 'SE', deploysFirst: true, initiativeBonus: 0,
        initiativeBonusTurns: 0, hiddenSetup: true, fortified: true, rdyTnPenalty: 0,
        offboard: { artillery: 0, reinforcements: [], airOnStation: [] } } },
  ],
};

describe('describeSheetDamage', () => {
  it('spells the marked card out in copyable words', () => {
    const text = describeSheetDamage({
      loc: { LA: 4, RT: 0 }, groups: { A: 1 }, engine: 1, legHits: 2, heat: 3,
      ammo: { 'LRM 20': 6 }, condition: 2, fuel: 12, out: false,
    });
    expect(text).toContain('boxes: LA 4');
    expect(text).not.toContain('RT');              // zeroes stay silent
    expect(text).toContain('groups: A 1');
    expect(text).toContain('engine crit ×1');
    expect(text).toContain('leg hits ×2');
    expect(text).toContain('heat 3');
    expect(text).toContain('ammo spent: LRM 20 ×6');
    expect(text).toContain('pilot hits 2');
    expect(describeSheetDamage(undefined)).toBe('');
    expect(describeSheetDamage({ out: true })).toBe('OUT OF ACTION');
  });
});

describe('buildBattlePack', () => {
  const html = buildBattlePack(roster, 'Operation TEST');

  it('carries the briefing: clock, table, rules, and each side\'s setup', () => {
    expect(html).toContain('Day 4, 01:00');
    expect(html).toContain('GROUND');
    expect(html).toContain('HIDDEN_SETUP');
    expect(html).toContain('Cavanaugh &lt;Lancers&gt;');   // names are escaped
    expect(html).toContain('<b>+2</b> for the first 3 turns');
    expect(html).toContain('deploys first');
    expect(html).toContain('+1 TN');
    expect(html).toContain('2 tubes');
    expect(html).toContain('Air on call: arrives turn <b>0</b>');
    expect(html).toContain('Hidden setup');
    expect(html).toContain('Fortified');
  });

  it('prints the roster with pilots, carry-over damage, and air state', () => {
    expect(html).toContain('Atlas AS7-D');
    expect(html).toContain('Cpt. Reyes');
    expect(html).toContain('(3/4)');
    expect(html).toContain('boxes: LA 4, CT 2');
    expect(html).toContain('clean sheet');           // the undamaged Wolfhound
    expect(html).toContain('44 (20/10)');            // Dragon's fuel with joker/bingo
  });

  it('the result form mirrors BattleResult, one checkbox row per unit', () => {
    const form = html.slice(html.indexOf('Result form'));
    expect(form.match(/☐ OK/g)!.length).toBe(3);     // one outcome row per unit
    expect(form).toContain('☐ Salvage');
    expect(form).toContain('☐ Dry');
    expect(form).toContain('Pilot hits');
    expect(form).toContain('Ejected');
    expect(form).toContain('Turns elapsed');
    expect(form).toContain('Who holds the hex/field');
  });
});
