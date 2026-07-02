/** Sheet persistence (ext): the marked-up card survives between battles. */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { buildHandoff } from '../../src/handoff/export.js';
import { buildBattleRoster } from '../../src/handoff/battle.js';
import { careerPass } from '../../src/engine/career.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { CAREER, CLOCK } from '../../src/rules.js';
import { mkFacility } from '../../src/fixtures.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { BattleResult, Engagement, Order, TruthState } from '../../src/core/types.js';

const DAY = CLOCK.TICKS_PER_DAY;
const LEFT_ARM_4 = { loc: { LA: 4 }, condition: 1, ammo: { 'LRM 15': 2 } };

function activate(truth: TruthState, order: Order) {
  truth.orders[order.id] = order;
  truth.formations[order.formationId].currentOrderId = order.id;
}

/** Frozen ground engagement with a named pilot on blue's first unit. */
function frozen(seed: string, setup?: (t: TruthState) => void): Campaign {
  const truth = baseTruth(seed);
  truth.clockMode = 'CONTACT';
  addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(5, 5), sigBase: 6 });
  const blue = addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(6, 5), omp: 4 });
  truth.sides['blue'].commandNodes = ['blue-1'];
  truth.pilots['vane'] = { id: 'vane', name: 'Vane', gunnery: 4, piloting: 5,
    kills: 0, ace: false, fatigue: 0, status: 'OK' };
  truth.units[blue.unitIds[0]].pilotIds = ['vane'];
  setup?.(truth);
  activate(truth, moveOrder('o', blue, 'MOVE', [gp(5, 5)]));
  const c = Campaign.create(truth);
  let guard = 0;
  while (!c.pendingEngagement && guard++ < 5) c.step();
  return c;
}

function ingestWithSheet(c: Campaign, hits = 1): string {
  const pkg = c.exportHandoff()!;
  const uid = c.truth.formations['blue-1'].unitIds[0];
  const result: BattleResult = {
    handoffId: pkg.id, victorSideId: 'blue', hexControlSideId: 'blue',
    unitOutcomes: [{ unitId: uid, damage: 'DAMAGED', ammoState: 'PARTIAL',
      sheetDamage: { ...LEFT_ARM_4, condition: hits, fuel: 180 },
      pilotOutcomes: [{ pilotId: 'vane', status: 'WOUNDED', hits }] }],
    ejections: [], turnsElapsed: 6, notes: '',
  };
  expect(c.ingestBattleResult(result).ok).toBe(true);
  return uid;
}

describe('the marked-up card comes home and rides out again', () => {
  it('ingest stores the blob (fuel stripped); the next handoff reseeds the same boxes', () => {
    const c = frozen('SHEET-1');
    const uid = ingestWithSheet(c);
    const u = c.truth.units[uid];
    expect(u.sheetDamage).toEqual({ loc: { LA: 4 }, condition: 1, ammo: { 'LRM 15': 2 } });
    expect(u.sheetDamage).not.toHaveProperty('fuel'); // fuel rides its own exact ledger

    // step past the post-battle rout window, then re-freeze on a fresh engagement
    for (let i = 0; i < 40 && !c.pendingEngagement; i++) c.step();
    const eng: Engagement = c.pendingEngagement ?? {
      id: 'eng:2', tick: c.truth.tick, hex: gp(5, 5), trigger: 'SAME_HEX',
      attackerSideId: 'red', defenderSideId: 'blue',
      attackerFormationIds: ['red-1'], defenderFormationIds: ['blue-1'], status: 'PENDING',
    };
    const pkg2 = buildHandoff(c.truth, eng);
    const mine = pkg2.perSide.find(p => p.sideId === 'blue')!
      .units.find(x => x.unitId === uid)!;
    expect(mine.sheetDamage).toEqual(u.sheetDamage); // same boxes, next table
    const roster = buildBattleRoster(c.truth, pkg2);
    const ru = roster.sides.find(s => s.sideId === 'blue')!.units.find(x => x.unitId === uid)!;
    expect(ru.sheetDamage).toEqual(u.sheetDamage);   // …all the way into the tracker
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('the shop wipes the sheet; a rearm wipes only the ammo boxes', () => {
    const c = frozen('SHEET-2', t => {
      t.facilities['depot'] = mkFacility({ id: 'depot', sideId: 'blue', name: 'Dump',
        pos: gp(5, 5), tags: ['DEPOT'], supplyPoints: 10 });
    });
    const uid = ingestWithSheet(c);

    // REARM clears the ammo boxes but leaves the armor damage marked
    c.inject({ type: 'UNIT_STATE_CHANGED', unitId: uid, damage: 'DAMAGED', ammoState: 'FULL' });
    expect(c.truth.units[uid].sheetDamage).toEqual({ loc: { LA: 4 }, condition: 1 });

    // the shop returns a clean sheet
    const r = c.repairUnit(uid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    c.truth.tick = r.readyTick;
    const events: GameEvent[] = [];
    careerPass(c.truth, e => { events.push(e); applyEvent(c.truth, e); });
    expect(c.truth.units[uid].damage).toBe('OK');
    expect(c.truth.units[uid].sheetDamage).toBeUndefined();
  });

  it('a healed pilot takes their hits off the sheet', () => {
    const c = frozen('SHEET-3');
    const uid = ingestWithSheet(c);
    expect(c.truth.units[uid].sheetDamage).toHaveProperty('condition');
    c.inject({ type: 'PILOT_STATE_CHANGED', pilotId: 'vane', status: 'OK' });
    expect(c.truth.units[uid].sheetDamage).toEqual({ loc: { LA: 4 }, ammo: { 'LRM 15': 2 } });
  });
});

describe('recovery scales per hit', () => {
  it('2 hits = 6 days of bed rest; 1 with a MASH per hit = 2 days', () => {
    const plain = frozen('HITS-1');
    const t0 = plain.truth.tick;
    ingestWithSheet(plain, 2);
    expect(plain.truth.pilots['vane'].recoverAtTick)
      .toBe(t0 + 2 * CAREER.WOUND_RECOVERY_DAYS * DAY);

    const mash = frozen('HITS-2', t => {
      addMechFormation(t, { id: 'medics', sideId: 'blue', pos: gp(2, 2) }, 1, { tags: ['MASH'] });
    });
    const t1 = mash.truth.tick;
    ingestWithSheet(mash, 2);
    expect(mash.truth.pilots['vane'].recoverAtTick)
      .toBe(t1 + 2 * CAREER.WOUND_RECOVERY_DAYS_MASH * DAY);
  });
});
