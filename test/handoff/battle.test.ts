/** Card-builder bridge — HandoffPackage → battle roster. */
import { describe, expect, it } from 'vitest';
import { Campaign } from '../../src/core/truth.js';
import { buildBattleRoster } from '../../src/handoff/battle.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { BattleResult } from '../../src/core/types.js';

function frozenCampaign(): Campaign {
  const truth = baseTruth('BATTLE-SEED');
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

describe('card-builder bridge — buildBattleRoster', () => {
  it('emits one roster side per handoff side, named from the campaign sides', () => {
    const c = frozenCampaign();
    const pkg = c.exportHandoff()!;
    const roster = buildBattleRoster(c.truth, pkg);

    expect(roster.handoffId).toBe(pkg.id);
    expect(roster.table).toBe('GROUND');
    expect(roster.sides).toHaveLength(2);
    expect(roster.sides.map(s => s.sideId).sort()).toEqual(['blue', 'red']);
    expect(roster.sides.map(s => s.name).sort()).toEqual(['Blue', 'Red']);
  });

  it('carries model names and per-unit pilot skills the card builder can resolve', () => {
    const c = frozenCampaign();
    const roster = buildBattleRoster(c.truth, c.exportHandoff()!);

    const red = roster.sides.find(s => s.sideId === 'red')!;
    expect(red.units).toHaveLength(2);
    expect(red.units.every(u => u.model === 'Warhammer WHM-6R')).toBe(true);
    // the ace's skills ride with their unit; the second crew gets the defaults
    const ace = red.units.find(u => u.pilot === 'Natasha "Black Widow"')!;
    expect([ace.gunnery, ace.piloting]).toEqual([2, 3]);
    const wingman = red.units.find(u => u.pilot === undefined)!;
    expect([wingman.gunnery, wingman.piloting]).toEqual([4, 5]);

    const blue = roster.sides.find(s => s.sideId === 'blue')!;
    expect(blue.units.map(u => u.model)).toEqual(['Atlas AS7-D']);
  });

  it('carries the tabletop setup (briefing) for each side and the map sheets', () => {
    const c = frozenCampaign();
    const pkg = c.exportHandoff()!;
    const roster = buildBattleRoster(c.truth, pkg);

    expect(Array.isArray(roster.mapSheets)).toBe(true);
    expect(roster.specialRules).toEqual(pkg.specialRules);
    for (const side of roster.sides) {
      const block = pkg.perSide.find(p => p.sideId === side.sideId)!;
      expect(side.setup.entryEdge).toBe(block.entryEdge);
      expect(side.setup.deploysFirst).toBe(block.deploysFirst);
      expect(side.setup.initiativeBonus).toBe(block.initiativeBonus);
      expect(side.setup.rdyTnPenalty).toBe(block.rdyTnPenalty);
      expect(side.setup.offboard.artillery).toBe(block.offboard.artillery.length);
      expect(Array.isArray(side.setup.offboard.reinforcements)).toBe(true);
    }
  });

  it('carries the campaign unit id and pilot ids for the return trip', () => {
    const c = frozenCampaign();
    const pkg = c.exportHandoff()!;
    const roster = buildBattleRoster(c.truth, pkg);
    const red = roster.sides.find(s => s.sideId === 'red')!;
    // ids echo the handoff's unitIds exactly (so the BattleResult maps home)
    expect(red.units.map(u => u.unitId).sort())
      .toEqual(pkg.perSide.find(p => p.sideId === 'red')!.units.map(u => u.unitId).sort());
    const ace = red.units.find(u => u.pilot === 'Natasha "Black Widow"')!;
    expect(ace.pilotIds).toEqual(['ace']);
  });

  it('falls back to the unit id when a unit has no model name', () => {
    const c = frozenCampaign();
    const pkg = c.exportHandoff()!;
    // wipe a model to simulate a bare unit
    const someUnitId = pkg.perSide[0].units[0].unitId;
    c.truth.units[someUnitId].model = '';
    const roster = buildBattleRoster(c.truth, pkg);
    const side = roster.sides.find(s => s.sideId === pkg.perSide[0].sideId)!;
    expect(side.units.some(u => u.model === someUnitId)).toBe(true);
  });
});

describe('BattleResult ingest — ejection without a board position', () => {
  it('drops the downed crew at the battle hex when the tracker omits pos', () => {
    const c = frozenCampaign();
    const pkg = c.exportHandoff()!;
    const hex = c.pendingEngagement!.hex!;
    const result: BattleResult = {
      handoffId: pkg.id,
      unitOutcomes: [],
      ejections: [{ pilotId: 'ace' }], // no pos — the tracker can't know coordinates
      turnsElapsed: 3,
      notes: 'test',
    };
    expect(c.ingestBattleResult(result).ok).toBe(true);
    const marker = Object.values(c.truth.markers).find(m => m.kind === 'DOWNED_CREW');
    expect(marker).toBeTruthy();
    expect(marker!.pos).toMatchObject({ kind: 'ground', q: hex.q, r: hex.r });
    expect(marker!.payload).toMatchObject({ pilotId: 'ace' });
  });
});
