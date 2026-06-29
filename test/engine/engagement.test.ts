/** M2 — engagement triggering & campaign freeze (core §7.1; spec §3.1). */
import { describe, expect, it } from 'vitest';
import { Campaign } from '../../src/core/truth.js';
import { addMechFormation, baseTruth, gp, moveOrder, T } from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

function activate(truth: TruthState, order: Order) {
  truth.orders[order.id] = order;
  truth.formations[order.formationId].currentOrderId = order.id;
}

describe('M2 — engagement detection', () => {
  it('same hex: a mover entering an enemy-occupied hex freezes the campaign', () => {
    const truth = baseTruth('ENG-SEED');
    truth.clockMode = 'CONTACT';
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(5, 5) });
    const blue = addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(6, 5), omp: 10 });
    activate(truth, moveOrder('o', blue, 'MOVE', [gp(5, 5)]));
    const campaign = Campaign.create(truth);

    campaign.step();
    const eng = campaign.pendingEngagement;
    expect(eng).toBeTruthy();
    expect(eng!.trigger).toBe('SAME_HEX');
    expect(eng!.hex).toMatchObject({ q: 5, r: 5 });
    expect([...eng!.attackerFormationIds, ...eng!.defenderFormationIds].sort())
      .toEqual(['blue-1', 'red-1']);

    // frozen: further steps are no-ops until resolved
    const before = campaign.truth.tick;
    expect(campaign.step()).toHaveLength(0);
    expect(campaign.truth.tick).toBe(before);
  });

  it('attacker = the side with better intel (it pressed the attack)', () => {
    const truth = baseTruth('ENG-SEED');
    truth.clockMode = 'CONTACT';
    const red = addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(5, 5) });
    const blue = addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(6, 5), omp: 10 });
    activate(truth, moveOrder('o', blue, 'MOVE', [gp(5, 5)]));
    truth.contacts['c'] = {
      id: 'contact:blue:red-1', observerSideId: 'blue', targetFormationId: 'red-1',
      kind: 'STANDARD', level: 3, lastConfirmedTick: 0, lastFadeTick: 0,
      estPos: gp(5, 5), posErrorHexes: 0, staleAsOfTick: 0,
    };
    const campaign = Campaign.create(truth);
    campaign.step();
    expect(campaign.pendingEngagement!.attackerSideId).toBe('blue');
  });

  it('STRIKE: a strike order pursues the contact estimate and engages on arrival', () => {
    const truth = baseTruth('ENG-SEED');
    truth.clockMode = 'CONTACT';
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(2, 5) });
    const blue = addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(8, 5), omp: 4 });
    truth.sides['blue'].commandNodes = ['blue-1'];
    truth.contacts['contact:blue:red-1'] = {
      id: 'contact:blue:red-1', observerSideId: 'blue', targetFormationId: 'red-1',
      kind: 'STANDARD', level: 3, lastConfirmedTick: 0, lastFadeTick: 0,
      estPos: gp(2, 5), posErrorHexes: 0, staleAsOfTick: 0,
      delivered: { level: 3, estPos: gp(2, 5), posErrorHexes: 0, asOfTick: 0 },
    };
    activate(truth, { ...moveOrder('o', blue, 'STRIKE', []), targetContactId: 'contact:blue:red-1' });
    const campaign = Campaign.create(truth);

    let guard = 0;
    while (!campaign.pendingEngagement && guard++ < 20) campaign.step();
    const eng = campaign.pendingEngagement;
    expect(eng).toBeTruthy();
    expect(eng!.trigger).toBe('STRIKE');
    expect(eng!.attackerSideId).toBe('blue');
    expect(campaign.truth.formations['blue-1'].pos).toMatchObject({ q: 2, r: 5 });
  });

  it('STRIKE on a stale estimate arrives at an empty hex and does NOT engage', () => {
    const truth = baseTruth('ENG-SEED');
    truth.clockMode = 'CONTACT';
    // the contact says hex (2,5) but the enemy is actually far away at (2,15)
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(2, 15) });
    const blue = addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(8, 5), omp: 4 });
    truth.sides['blue'].commandNodes = ['blue-1'];
    truth.contacts['contact:blue:red-1'] = {
      id: 'contact:blue:red-1', observerSideId: 'blue', targetFormationId: 'red-1',
      kind: 'STANDARD', level: 2, lastConfirmedTick: 0, lastFadeTick: 0,
      estPos: gp(2, 5), posErrorHexes: 0, staleAsOfTick: 0,
      delivered: { level: 2, estPos: gp(2, 5), posErrorHexes: 0, asOfTick: 0 },
    };
    activate(truth, { ...moveOrder('o', blue, 'STRIKE', []), targetContactId: 'contact:blue:red-1' });
    const campaign = Campaign.create(truth);

    let guard = 0;
    while (campaign.truth.formations['blue-1'].pos.kind === 'ground' &&
           (campaign.truth.formations['blue-1'].pos as { q: number }).q > 2 && guard++ < 20) {
      campaign.step();
      if (campaign.pendingEngagement) break;
    }
    expect(campaign.pendingEngagement).toBeNull();
    expect(campaign.truth.formations['blue-1'].pos).toMatchObject({ q: 2, r: 5 });
  });

  it('SCREEN: an enemy entering a screened hex triggers an intercept', () => {
    const truth = baseTruth('ENG-SEED');
    truth.clockMode = 'CONTACT';
    const screen = addMechFormation(truth, { id: 'blue-screen', sideId: 'blue', pos: gp(5, 5) });
    activate(truth, { ...moveOrder('os', screen, 'SCREEN', [gp(6, 5)]) }); // screens (5,5)+(6,5)
    const red = addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(7, 5), omp: 4 });
    truth.sides['red'].commandNodes = ['red-1'];
    activate(truth, moveOrder('or', red, 'MOVE', [gp(6, 5)]));
    const campaign = Campaign.create(truth);

    campaign.step();
    const eng = campaign.pendingEngagement;
    expect(eng).toBeTruthy();
    expect(eng!.trigger).toBe('SCREEN');
    expect(eng!.hex).toMatchObject({ q: 6, r: 5 });
    expect(eng!.attackerSideId).toBe('red'); // the mover is the attacker
    expect(eng!.defenderSideId).toBe('blue');
  });
});
