/** The career loop (ext): pilot XP & wounds, the repair economy, salvage → roster. */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { careerPass, battleXp } from '../../src/engine/career.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { CAREER, CLOCK, SUPPLY } from '../../src/rules.js';
import { mkFacility } from '../../src/fixtures.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { BattleResult, Order, Pilot, TruthState } from '../../src/core/types.js';

const DAY = CLOCK.TICKS_PER_DAY;

function mkPilot(id: string, p: Partial<Pilot> = {}): Pilot {
  return { id, name: id, gunnery: 4, piloting: 5, kills: 0, ace: false, fatigue: 0,
           status: 'OK', ...p };
}

function activate(truth: TruthState, order: Order) {
  truth.orders[order.id] = order;
  truth.formations[order.formationId].currentOrderId = order.id;
}

/** A campaign frozen on a same-hex engagement at (5,5) — the roundtrip.test.ts pattern. */
function frozenCampaign(seed: string, setup?: (t: TruthState) => void): Campaign {
  const truth = baseTruth(seed);
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

describe('career — pilot XP & wounds', () => {
  it('survivors earn XP on ingest; winners and kills earn more; skills improve at the threshold', () => {
    const campaign = frozenCampaign('XP-SEED', t => {
      const u = t.formations['blue-1'].unitIds[0];
      t.pilots['vane'] = mkPilot('vane', { xp: 2 }); // 2 + 6 crosses XP_PER_IMPROVEMENT (8)
      t.units[u].pilotIds = ['vane'];
    });
    const pkg = campaign.exportHandoff()!;
    const blueUnit = campaign.truth.formations['blue-1'].unitIds[0];
    const result: BattleResult = {
      handoffId: pkg.id, victorSideId: 'blue', hexControlSideId: 'blue',
      unitOutcomes: [{ unitId: blueUnit, damage: 'OK', ammoState: 'PARTIAL',
                       pilotOutcomes: [{ pilotId: 'vane', status: 'OK', kills: 2 }] }],
      ejections: [], turnsElapsed: 6, notes: '',
    };
    expect(campaign.ingestBattleResult(result).ok).toBe(true);

    const vane = campaign.truth.pilots['vane'];
    expect(battleXp(true, 2)).toBe(CAREER.XP_SURVIVE + CAREER.XP_WIN + 2 * CAREER.XP_PER_KILL);
    expect(vane.xp).toBe(2 + 6);
    expect(vane.kills).toBe(2);
    // crossed 8 XP: the weaker skill (piloting 5) improves
    expect(vane.piloting).toBe(4);
    expect(vane.gunnery).toBe(4);
    expect(replay(campaign.store.all())).toEqual(campaign.truth);
  });

  it('a wound schedules recovery; careerPass heals it on time; KIA earns nothing', () => {
    const campaign = frozenCampaign('WOUND-SEED', t => {
      const [u1, u2] = t.formations['blue-1'].unitIds;
      t.pilots['hurt'] = mkPilot('hurt');
      t.pilots['gone'] = mkPilot('gone');
      t.units[u1].pilotIds = ['hurt'];
      t.units[u2].pilotIds = ['gone'];
    });
    const pkg = campaign.exportHandoff()!;
    const [u1, u2] = campaign.truth.formations['blue-1'].unitIds;
    const tick0 = campaign.truth.tick;
    campaign.ingestBattleResult({
      handoffId: pkg.id, victorSideId: 'red', hexControlSideId: 'red',
      unitOutcomes: [
        { unitId: u1, damage: 'DAMAGED', ammoState: 'PARTIAL',
          pilotOutcomes: [{ pilotId: 'hurt', status: 'WOUNDED' }] },
        { unitId: u2, damage: 'DESTROYED', ammoState: 'DRY',
          pilotOutcomes: [{ pilotId: 'gone', status: 'KIA' }] },
      ],
      ejections: [], turnsElapsed: 12, notes: '',
    });
    expect(campaign.truth.pilots['hurt'].status).toBe('WOUNDED');
    expect(campaign.truth.pilots['hurt'].recoverAtTick)
      .toBe(tick0 + CAREER.WOUND_RECOVERY_DAYS * DAY);
    expect(campaign.truth.pilots['hurt'].xp).toBe(CAREER.XP_SURVIVE); // survived, lost
    expect(campaign.truth.pilots['gone'].xp).toBeUndefined();        // the dead learn nothing

    // bed rest: past the recovery tick, careerPass discharges the pilot
    campaign.truth.tick = tick0 + CAREER.WOUND_RECOVERY_DAYS * DAY;
    const events: GameEvent[] = [];
    careerPass(campaign.truth, e => { events.push(e); applyEvent(campaign.truth, e); });
    expect(campaign.truth.pilots['hurt'].status).toBe('OK');
    expect(campaign.truth.pilots['hurt'].recoverAtTick).toBeUndefined();
  });

  it('the fifth kill turns the ace flag on', () => {
    const truth = baseTruth('ACE-SEED');
    truth.pilots['hotshot'] = mkPilot('hotshot', { kills: 3 });
    const c = Campaign.create(truth);
    c.inject({ type: 'PILOT_XP', pilotId: 'hotshot', xpDelta: 5, kills: 2,
               reason: 'test', tick: 0 });
    expect(c.truth.pilots['hotshot'].kills).toBe(5);
    expect(c.truth.pilots['hotshot'].ace).toBe(true);
  });
});

describe('career — the repair economy', () => {
  function depotTruth(seed: string) {
    const truth = baseTruth(seed);
    truth.facilities['depot'] = mkFacility({
      id: 'depot', sideId: 'blue', name: 'Fitzgerald Yards', pos: gp(4, 4),
      tags: ['DEPOT'], supplyPoints: 10,
    });
    return truth;
  }

  it('repairs a DAMAGED unit at a depot: SP drawn, healed after the repair days', () => {
    const truth = depotTruth('REPAIR-SEED');
    const f = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(4, 4) });
    truth.units[f.unitIds[0]].damage = 'DAMAGED';
    const c = Campaign.create(truth);

    const r = c.repairUnit(f.unitIds[0]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readyTick).toBe(CAREER.REPAIR.DAMAGED.DAYS * DAY);
    expect(c.truth.facilities['depot'].supplyPoints).toBe(10 - CAREER.REPAIR.DAMAGED.SP);
    expect(c.repairUnit(f.unitIds[0]).ok).toBe(false); // already in the shop

    c.truth.tick = r.readyTick;
    const events: GameEvent[] = [];
    careerPass(c.truth, e => { events.push(e); applyEvent(c.truth, e); });
    expect(c.truth.units[f.unitIds[0]].damage).toBe('OK');
    expect(c.truth.units[f.unitIds[0]].repairReadyTick).toBeUndefined();
  });

  it('CRIPPLED costs more and takes longer; no shop in the hex refuses', () => {
    const truth = depotTruth('REPAIR-SEED2');
    const near = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(4, 4) });
    const far = addMechFormation(truth, { id: 'm2', sideId: 'blue', pos: gp(9, 9) });
    truth.units[near.unitIds[0]].damage = 'CRIPPLED';
    truth.units[far.unitIds[0]].damage = 'DAMAGED';
    const c = Campaign.create(truth);

    const r = c.repairUnit(near.unitIds[0]);
    expect(r.ok && r.readyTick === CAREER.REPAIR.CRIPPLED.DAYS * DAY).toBe(true);
    expect(c.truth.facilities['depot'].supplyPoints).toBe(10 - CAREER.REPAIR.CRIPPLED.SP);
    expect(c.repairUnit(far.unitIds[0]).ok).toBe(false); // nowhere to fix it
  });

  it('a carrier bay repairs an embarked unit, tying up a turnaround crew', () => {
    const truth = baseTruth('REPAIR-CARRIER');
    const ds = addMechFormation(truth, { id: 'ds1', sideId: 'blue', pos: gp(7, 7) },
      1, { class: 'DROPSHIP' });
    ds.carrier = { bays: 2, crews: 1, avFuelTons: 20 };
    const lance = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(7, 7) });
    lance.mounted = { carrierFormationId: 'ds1' };
    truth.units[lance.unitIds[0]].damage = 'DAMAGED';
    truth.units[lance.unitIds[1]].damage = 'DAMAGED';
    const c = Campaign.create(truth);

    const r = c.repairUnit(lance.unitIds[0]);
    expect(r.ok).toBe(true);
    expect(c.truth.formations['ds1'].carrier!.crewBusyUntil).toHaveLength(1);
    const second = c.repairUnit(lance.unitIds[1]);
    expect(second.ok).toBe(false); // the one crew is busy
    if (!second.ok) expect(second.reason).toMatch(/crew/);
    expect(replay(c.store.all())).toEqual(c.truth);
  });
});

describe('career — salvage becomes roster', () => {
  function wreckTruth(seed: string) {
    const truth = baseTruth(seed);
    truth.facilities['depot'] = mkFacility({
      id: 'depot', sideId: 'blue', name: 'Fitzgerald Yards', pos: gp(5, 5),
      tags: ['DEPOT'], supplyPoints: 10,
    });
    const blue = addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(5, 5) });
    // a recovered crew waits in the side pool (as after a SAR pickup)
    truth.pilots['lucky'] = mkPilot('lucky', { status: 'POOL' });
    truth.units[blue.unitIds[0]].pilotIds = ['lucky'];
    // the wreck: an enemy mech that died in the battle at 5,5
    const red = addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(5, 5) },
      1, { model: 'Atlas AS7-D', name: 'Widowmaker' });
    truth.units[red.unitIds[0]].damage = 'SALVAGE';
    truth.salvage['tok'] = { id: 'tok', hex: gp(5, 5),
                             sourceUnitId: red.unitIds[0], heldBy: 'blue' };
    return truth;
  }

  it('a UNIT recovery queues a refit project (SALV-A rolls 10)', () => {
    const c = Campaign.create(wreckTruth('SALV-A'));
    const r = c.resolveSalvage('tok');
    expect('outcome' in r && r.outcome).toBe('UNIT');
    const refit = Object.values(c.truth.refits ?? {})[0];
    expect(refit).toBeDefined();
    expect(refit.status).toBe('AWAITING');
    expect(refit.sideId).toBe('blue');
    expect(refit.model).toBe('Atlas AS7-D');
  });

  it('a PARTS strip credits SALVAGE_FAIL_SP to the depot in the hex (SALV-D rolls 5)', () => {
    const c = Campaign.create(wreckTruth('SALV-D'));
    const r = c.resolveSalvage('tok');
    expect('outcome' in r && r.outcome).toBe('PARTS');
    expect(c.truth.facilities['depot'].supplyPoints).toBe(10 + SUPPLY.SALVAGE_FAIL_SP);
  });

  it('startRefit spends SP; careerPass delivers the rebuilt unit with a POOL pilot', () => {
    const c = Campaign.create(wreckTruth('SALV-A'));
    const salvageRes = c.resolveSalvage('tok');
    expect('refitId' in salvageRes && salvageRes.refitId).toBeTruthy();
    const refitId = ('refitId' in salvageRes && salvageRes.refitId) as string;

    const start = c.startRefit(refitId, 'depot', 'blue-1');
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(c.truth.facilities['depot'].supplyPoints).toBe(10 - CAREER.REFIT.SP);

    c.truth.tick = start.readyTick;
    const events: GameEvent[] = [];
    careerPass(c.truth, e => { events.push(e); applyEvent(c.truth, e); });

    const done = events.find(e => e.type === 'REFIT_COMPLETED');
    expect(done).toBeDefined();
    const unitId = `unit:refit:${refitId}`;
    const u = c.truth.units[unitId];
    expect(u).toBeDefined();
    expect(u.sideId).toBe('blue');
    expect(u.damage).toBe('OK');
    expect(u.model).toBe('Atlas AS7-D');
    expect(u.pilotIds).toEqual(['lucky']);                 // the pool pilot takes the seat
    expect(c.truth.pilots['lucky'].status).toBe('OK');
    expect(c.truth.formations['blue-1'].unitIds).toContain(unitId);
    expect(c.truth.refits?.[refitId]).toBeUndefined();     // project closed
  });

  it('refuses a refit at a facility that cannot rebuild, or without the SP', () => {
    const truth = wreckTruth('SALV-A');
    truth.facilities['tower'] = mkFacility({
      id: 'tower', sideId: 'blue', name: 'Sensor Tower', pos: gp(6, 6),
      tags: [], supplyPoints: 50,
    });
    truth.facilities['depot'].supplyPoints = 1; // too poor
    const c = Campaign.create(truth);
    const r = c.resolveSalvage('tok');
    const refitId = ('refitId' in r && r.refitId) as string;
    expect(c.startRefit(refitId, 'tower', 'blue-1').ok).toBe(false);
    expect(c.startRefit(refitId, 'depot', 'blue-1').ok).toBe(false);
  });
});
