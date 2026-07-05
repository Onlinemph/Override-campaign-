/** M2 — HandoffPackage export & BattleResult import (spec §3.6; core §7.2). */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { buildHandoff } from '../../src/handoff/export.js';
import { mkUnit, mkFacility } from '../../src/fixtures.js';
import { addMechFormation, baseTruth, gp, moveOrder, T } from '../helpers.js';
import type { BattleResult, Engagement, Order, TruthState } from '../../src/core/types.js';

function activate(truth: TruthState, order: Order) {
  truth.orders[order.id] = order;
  truth.formations[order.formationId].currentOrderId = order.id;
}

/** Build a campaign already frozen on a same-hex engagement at (5,5). */
function frozenCampaign(seed = 'HANDOFF-SEED', setup?: (t: TruthState) => void): Campaign {
  const truth = baseTruth(seed, [{ q: 5, r: 5, terrain: 'WOODS' }]);
  truth.clockMode = 'CONTACT';
  addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(5, 5), sigBase: 6 });
  const blue = addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(6, 5), omp: 4 });
  truth.sides['blue'].commandNodes = ['blue-1'];
  activate(truth, moveOrder('o', blue, 'MOVE', [gp(5, 5)]));
  setup?.(truth);
  const campaign = Campaign.create(truth);
  let guard = 0;
  while (!campaign.pendingEngagement && guard++ < 5) campaign.step();
  return campaign;
}

describe('M2 — handoff export', () => {
  it('builds a ground package with both sides and terrain-derived map hints', () => {
    const campaign = frozenCampaign();
    const pkg = campaign.exportHandoff()!;
    expect(pkg.table).toBe('GROUND');
    expect(pkg.mapSpec.sheetsHint).toContain('WOODS');
    expect(pkg.perSide).toHaveLength(2);
    expect(pkg.perSide.map(p => p.sideId).sort()).toEqual(['blue', 'red']);
    expect(campaign.pendingEngagement!.status).toBe('EXPORTED');
  });

  it('intel = initiative: the better-informed side gets the bonus, the blind side deploys first', () => {
    // Co-located battles auto-LOCK both sides (M1, core §6.4), so a meaningful intel
    // differential survives only when forces are not in the same hex — e.g. a SCREEN
    // intercept where the screener sits adjacent. Test buildHandoff directly.
    const truth = baseTruth('INIT-SEED');
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(5, 5) });   // attacker (mover)
    addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(6, 5) });  // defender (screener)
    truth.contacts['c'] = {
      id: 'contact:blue:red-1', observerSideId: 'blue', targetFormationId: 'red-1',
      kind: 'STANDARD', level: 3, lastConfirmedTick: 0, lastFadeTick: 0,
      estPos: gp(5, 5), posErrorHexes: 0, staleAsOfTick: 0,
    };
    const eng: Engagement = {
      id: 'eng:test', tick: 0, hex: gp(5, 5), trigger: 'SCREEN',
      attackerSideId: 'red', defenderSideId: 'blue',
      attackerFormationIds: ['red-1'], defenderFormationIds: ['blue-1'], status: 'PENDING',
    };
    const pkg = buildHandoff(truth, eng);
    const blue = pkg.perSide.find(p => p.sideId === 'blue')!;
    const red = pkg.perSide.find(p => p.sideId === 'red')!;
    expect(blue.initiativeBonus).toBe(3);       // 3 levels of advantage
    expect(blue.initiativeBonusTurns).toBe(3);
    expect(red.deploysFirst).toBe(true);        // the disadvantaged side deploys first
    expect(blue.deploysFirst).toBe(false);
  });

  it('posture → hidden/fortified; RDY band → TN penalty', () => {
    const campaign = frozenCampaign('HANDOFF-SEED', t => {
      t.formations['red-1'].posture = 'DUG_IN';
      t.formations['red-1'].rdy = 3; // band 2–4 ⇒ +2
    });
    const pkg = campaign.exportHandoff()!;
    const red = pkg.perSide.find(p => p.sideId === 'red')!;
    expect(red.fortified).toBe(true);
    expect(red.rdyTnPenalty).toBe(2);
    expect(pkg.specialRules).toContain('FORTIFIED');
  });

  it('off-board artillery in range is listed; out of range is not', () => {
    const truth = baseTruth('ARTY-SEED');
    const eng: Engagement = {
      id: 'eng:test', tick: 0, hex: gp(5, 5), trigger: 'SAME_HEX',
      attackerSideId: 'blue', defenderSideId: 'red',
      attackerFormationIds: [], defenderFormationIds: [], status: 'PENDING',
    };
    // Long Tom (range 15) at distance 10: in range. Arrow IV (range 4) at distance 10: out.
    const lt = addMechFormation(truth, { id: 'blue-lt', sideId: 'blue', pos: gp(15, 5) },
      1, { tags: ['LONG_TOM'], name: 'Long Tom' });
    const arrow = addMechFormation(truth, { id: 'blue-arrow', sideId: 'blue', pos: gp(15, 5) },
      1, { tags: ['ARROW_IV'], name: 'Arrow IV' });
    truth.formations['blue-lt'].onNet = true;
    truth.formations['blue-arrow'].onNet = true;
    const pkg = buildHandoff(truth, eng);
    const blue = pkg.perSide.find(p => p.sideId === 'blue')!;
    const artyUnits = blue.offboard.artillery.map(a => truth.units[a.unitId].name);
    expect(artyUnits).toContain('Long Tom');
    expect(artyUnits).not.toContain('Arrow IV');
    expect(blue.offboard.artillery.find(a => truth.units[a.unitId].name === 'Long Tom')!.rangeHexesRemaining)
      .toBe(5);
  });

  it('on-net friendly reinforcements within range get arrivesTurn = hexes × 5', () => {
    const truth = baseTruth('REINF-SEED');
    const eng: Engagement = {
      id: 'eng:test', tick: 0, hex: gp(5, 5), trigger: 'SAME_HEX',
      attackerSideId: 'blue', defenderSideId: 'red',
      attackerFormationIds: ['blue-1'], defenderFormationIds: [], status: 'PENDING',
    };
    addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(5, 5) });
    const reinf = addMechFormation(truth, { id: 'blue-reinf', sideId: 'blue', pos: gp(9, 5) });
    reinf.onNet = true; // 4 hexes away
    const pkg = buildHandoff(truth, eng);
    const blue = pkg.perSide.find(p => p.sideId === 'blue')!;
    expect(blue.offboard.reinforcements).toHaveLength(1);
    expect(blue.offboard.reinforcements[0]).toMatchObject({ formationId: 'blue-reinf', arrivesTurn: 20 });
  });

  it('units carry default pilot skills 4/5 when no pilot is assigned', () => {
    const pkg = frozenCampaign().exportHandoff()!;
    const red = pkg.perSide.find(p => p.sideId === 'red')!;
    expect(red.units[0].pilotSkills).toEqual([4, 5]);
  });
});

describe('M2 — battle result import', () => {
  it('applies damage, RDY (−1 / −2 lost), auto-LOCK, salvage, and unfreezes', () => {
    const campaign = frozenCampaign();
    const pkg = campaign.exportHandoff()!;
    const redUnit = campaign.truth.formations['red-1'].unitIds[0];
    const blueUnit = campaign.truth.formations['blue-1'].unitIds[0];

    const result: BattleResult = {
      handoffId: pkg.id, victorSideId: 'blue', hexControlSideId: 'blue',
      unitOutcomes: [
        ...campaign.truth.formations['red-1'].unitIds.map(uid => ({
          unitId: uid, damage: 'DESTROYED' as const, ammoState: 'DRY',
          pilotOutcomes: [] })),
        { unitId: blueUnit, damage: 'DAMAGED' as const, ammoState: 'PARTIAL', pilotOutcomes: [] },
      ],
      ejections: [], turnsElapsed: 9, notes: 'clean sweep',
    };
    const blueRdyBefore = campaign.truth.formations['blue-1'].rdy;
    const redRdyBefore = campaign.truth.formations['red-1'].rdy;

    expect(campaign.ingestBattleResult(result).ok).toBe(true);
    expect(campaign.truth.pendingEngagementId).toBeNull();

    expect(campaign.truth.units[blueUnit].damage).toBe('DAMAGED');
    expect(campaign.truth.units[redUnit].damage).toBe('DESTROYED');
    // red lost all units ⇒ destroyed formation
    expect(campaign.truth.formations['red-1'].destroyed).toBe(true);
    // winner −1, loser would be −2 but it's destroyed; winner RDY applied
    expect(campaign.truth.formations['blue-1'].rdy).toBe(blueRdyBefore - 1);
    // salvage created for the hex controller
    const salvage = Object.values(campaign.truth.salvage);
    expect(salvage.length).toBe(campaign.truth.formations['red-1'].unitIds.length);
    expect(salvage.every(s => s.heldBy === 'blue')).toBe(true);
    expect(redRdyBefore).toBeGreaterThan(0);
  });

  it('ejections become DOWNED_CREW markers; pilot status updates', () => {
    const campaign = frozenCampaign('EJECT-SEED', t => {
      t.pilots['ace'] = { id: 'ace', name: 'Ace', gunnery: 3, piloting: 4, kills: 6,
                          ace: true, fatigue: 0, status: 'OK' };
      const u = t.formations['red-1'].unitIds[0];
      t.units[u].pilotIds = ['ace'];
    });
    const pkg = campaign.exportHandoff()!;
    const result: BattleResult = {
      handoffId: pkg.id, victorSideId: 'blue', hexControlSideId: 'blue',
      unitOutcomes: [{ unitId: campaign.truth.formations['red-1'].unitIds[0],
                       damage: 'DESTROYED', ammoState: 'DRY',
                       pilotOutcomes: [{ pilotId: 'ace', status: 'DOWNED' }] }],
      ejections: [{ pilotId: 'ace', pos: gp(5, 5) }], turnsElapsed: 6, notes: '',
    };
    campaign.ingestBattleResult(result);
    expect(campaign.truth.pilots['ace'].status).toBe('DOWNED');
    const markers = Object.values(campaign.truth.markers);
    expect(markers.some(m => m.kind === 'DOWNED_CREW' && m.payload.pilotId === 'ace')).toBe(true);
  });

  it('rout: a survivor dropping to RDY ≤1 becomes uncommandable for 2 pulses', () => {
    const campaign = frozenCampaign('ROUT-SEED', t => {
      t.formations['red-1'].rdy = 2; // loses ⇒ −2 ⇒ 0
    });
    const pkg = campaign.exportHandoff()!;
    const result: BattleResult = {
      handoffId: pkg.id, victorSideId: 'blue', hexControlSideId: 'blue',
      unitOutcomes: campaign.truth.formations['red-1'].unitIds.map(uid => ({
        unitId: uid, damage: 'DAMAGED' as const, ammoState: 'PARTIAL', pilotOutcomes: [] })),
      ejections: [], turnsElapsed: 8, notes: '',
      withdrewVia: { 'red-1': 'NE' },
    };
    campaign.ingestBattleResult(result);
    expect(campaign.truth.formations['red-1'].rdy).toBe(0);
    expect(campaign.truth.formations['red-1'].routUntilTick).toBeGreaterThan(campaign.truth.tick);
    // routed formation refuses new orders
    const r = campaign.issueOrder({ ...({} as Order), id: 'x', sideId: 'red',
      formationId: 'red-1', kind: 'MOVE', conditionals: [], issuedTick: 0, effectiveTick: 0,
      path: [gp(6, 6)] });
    expect(r.ok).toBe(false);
  });

  it('salvage resolution: 2d6 ≥8 ⇒ UNIT else PARTS (logged roll), token consumed', () => {
    const campaign = frozenCampaign('SALV-SEED');
    const pkg = campaign.exportHandoff()!;
    campaign.ingestBattleResult({
      handoffId: pkg.id, victorSideId: 'blue', hexControlSideId: 'blue',
      unitOutcomes: campaign.truth.formations['red-1'].unitIds.map(uid => ({
        unitId: uid, damage: 'DESTROYED' as const, ammoState: 'DRY', pilotOutcomes: [] })),
      ejections: [], turnsElapsed: 5, notes: '',
    });
    const tokenId = Object.keys(campaign.truth.salvage)[0];
    const res = campaign.resolveSalvage(tokenId);
    expect(res).toHaveProperty('outcome');
    expect(campaign.truth.salvage[tokenId]).toBeUndefined();
  });

  it('the full round-trip is auditable: replay reproduces truth byte-for-byte', () => {
    const campaign = frozenCampaign('AUDIT-SEED');
    const pkg = campaign.exportHandoff()!;
    campaign.ingestBattleResult({
      handoffId: pkg.id, victorSideId: 'blue', hexControlSideId: 'blue',
      unitOutcomes: [{ unitId: campaign.truth.formations['red-1'].unitIds[0],
                       damage: 'CRIPPLED', ammoState: 'DRY', pilotOutcomes: [] }],
      ejections: [], turnsElapsed: 7, notes: '', withdrewVia: { 'red-1': 'NE' },
    });
    campaign.step(); // resume the campaign post-battle
    expect(replay(campaign.store.all())).toEqual(campaign.truth);
  });
});
