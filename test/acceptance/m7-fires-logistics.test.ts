/**
 * M7 acceptance — Fires & Logistics, the roadmap's two set pieces:
 *   1. the §6.5 chaff trick: fire one round from a hex you're abandoning and hand the
 *      enemy a confident, wrong fix;
 *   2. an offensive starved by a cut supply line (interdiction, core §10.3).
 * Both driven through the full campaign engine, with byte-exact replay.
 */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { rollDice } from '../../src/core/rng.js';
import { mkFacility } from '../../src/fixtures.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

const SEED = 'M7-ACCEPTANCE';

describe('M7 acceptance — the chaff trick (core §6.5/§9.2)', () => {
  it('a battery fires, the enemy locks the firing hex, the battery scoots, the fix goes stale', () => {
    const truth = baseTruth(SEED, [], 30, 12);
    truth.clockMode = 'CONTACT';
    // Blue battery, on-net, with a forward observer so the round lands clean
    const bat = addMechFormation(truth, { id: 'blue-arty', sideId: 'blue', pos: gp(6, 6), br: 20, omp: 4 },
      1, { tags: ['LONG_TOM'], class: 'SUPPORT' });
    truth.sides['blue'].commandNodes = ['blue-arty'];
    addMechFormation(truth, { id: 'blue-fo', sideId: 'blue', pos: gp(18, 6) }); // FO with LOS
    // Red's own battery provides counter-battery reach (its tubes range the firing hex)
    // but only short sensors — it catches the muzzle flash, not the subsequent move
    addMechFormation(truth, { id: 'red-cb', sideId: 'red', pos: gp(12, 6), br: 20 },
      1, { tags: ['LONG_TOM'], class: 'SUPPORT' });
    addMechFormation(truth, { id: 'red-tgt', sideId: 'red', pos: gp(20, 6) });

    // a standing fire mission on the red target's hex, then a move order to scoot
    truth.orders['fire'] = { ...moveOrder('fire', bat, 'FIRE', []), targetHex: gp(20, 6) } as Order;
    bat.currentOrderId = 'fire';
    const c = Campaign.create(truth);

    c.step(); // fires resolve: counter-battery paints the firing hex
    const cb = c.truth.contacts['contact:red:blue-arty'];
    expect(cb).toBeTruthy();
    expect(cb.level).toBe(3);                       // CONTACT — a confident fix
    expect(cb.estPos).toMatchObject({ q: 6, r: 6 }); // ...on the firing hex
    const firedTick = c.truth.tick;

    // the battery shoots and scoots: order it to move off
    expect(c.issueOrder({ ...moveOrder('scoot', c.truth.formations['blue-arty'], 'MOVE',
      [gp(6, 8), gp(6, 10)]), id: 'scoot' }).ok).toBe(true);
    for (let i = 0; i < 6; i++) c.step();

    // red's belief still points at the abandoned hex while the battery has moved on
    const red = c.truth.contacts['contact:red:blue-arty'];
    expect(red.delivered).toBeTruthy();
    expect(red.delivered!.estPos).toMatchObject({ q: 6, r: 6 }); // confident, now wrong
    expect(red.delivered!.asOfTick).toBeLessThanOrEqual(firedTick); // and stale
    const truePos = c.truth.formations['blue-arty'].pos as { q: number; r: number };
    expect(truePos.r).toBeGreaterThan(6); // really somewhere else now

    expect(replay(c.store.all())).toEqual(c.truth);
  });
});

describe('M7 acceptance — the starved offensive (core §10.3)', () => {
  it('cutting the only supply road bleeds the spearhead RDY day after day', () => {
    // a causeway theater: the spearhead can only be fed down one road
    const causeway = [];
    for (let q = 0; q < 28; q++) {
      causeway.push({ q, r: 0, terrain: 'WATER' as const });
      causeway.push({ q, r: 1, infra: ['ROAD' as const] });
      causeway.push({ q, r: 2, terrain: 'WATER' as const });
    }
    const truth = baseTruth(SEED + '-SUP', causeway, 28, 3);
    truth.facilities['blue-depot'] = mkFacility({ id: 'blue-depot', sideId: 'blue', name: 'Rear Depot',
      pos: gp(2, 1), tags: ['DEPOT'], supplyPoints: 99, isCommandNode: true });
    truth.sides['blue'].commandNodes = ['blue-depot'];
    const spearhead = addMechFormation(truth, { id: 'blue-spear', sideId: 'blue', pos: gp(22, 1) });
    spearhead.rdy = 10;
    const c = Campaign.create(truth);

    // a day in supply: RDY holds at 10
    while (c.truth.tick < 240) c.step();
    expect(c.truth.formations['blue-spear'].supply.inSupply).toBe(true);
    expect(c.truth.formations['blue-spear'].rdy).toBe(10);

    // a raider cuts the causeway behind the spearhead — the line is severed
    c.spawnFormation(
      { id: 'red-raider', sideId: 'red', name: 'Raider', unitIds: ['rr-1'],
        pos: gp(11, 1), omp: 4, br: 10, sigBase: 7, sns: { passive: 2, active: 4 }, rdy: 10,
        emcon: 'PASSIVE', posture: 'NONE', onNet: true, standingOrderIds: [],
        supply: { lastSuppliedTick: 0, inSupply: true } },
      [{ id: 'rr-1', sideId: 'red', name: 'Panther', model: 'PNT-9R', class: 'MECH',
        bv: 1000, pv: 25, walkOrCruise: 4, run: 6, jump: 0, damage: 'OK', pilotIds: [],
        ammoState: 'FULL', tags: [] }]);

    // two more days, now cut off: RDY bleeds −1/day (core §10.2)
    const rdyBefore = c.truth.formations['blue-spear'].rdy;
    while (c.truth.tick < 240 * 3) c.step();
    expect(c.truth.formations['blue-spear'].supply.inSupply).toBe(false);
    expect(c.truth.formations['blue-spear'].rdy).toBeLessThan(rdyBefore);
    // the depot still has all its SP — the goods just can't get through
    expect(c.truth.facilities['blue-depot'].supplyPoints).toBeGreaterThan(90);

    expect(replay(c.store.all())).toEqual(c.truth);
    for (const l of c.store.all()) {
      if (l.event.type === 'DIE_ROLLED') {
        expect(rollDice(SEED + '-SUP', l.event.roll.seedCursor, l.event.roll.dice).result)
          .toBe(l.event.roll.result);
      }
    }
  });
});
