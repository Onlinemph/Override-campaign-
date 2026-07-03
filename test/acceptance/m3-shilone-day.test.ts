/**
 * M3 acceptance — the SKYWATCH §12 worked example, "One Shilone, One Day", re-based to
 * the D-038 ruling (speeds are Safe Thrust per 6-minute turn): 400 → 360 → 299 → 279 FP.
 *
 *   0500 (pulse 5)  Talon-2 (Shilone, 400 FP) takes ALERT-15. Fatigue clock starts.
 *   ~0900 (t91)     the EW picket resolves the bandit inbound: SHADOW.
 *                   The ATO conditional fires: scramble.
 *   0912 (t92)      runway takeoff (4) + climb to HIGH (12)            → 384
 *   t93–t94         two contact turns of dash at 6 hexes / 12 FP each  → 360
 *                   (air-to-air radar reaches 6 hexes, so the chase holds LOCK and the
 *                    lead prediction plots clean — caught 12 hexes out)
 *   the merge       handoff: velocity 6 (dash), Energy 6+6 = 12; fpOnTable 360
 *   the table       9 turns, 61 FP burned, bandit's wing torn off      → 299
 *   RTB             cruise home 18 hexes (18) + runway landing (2)     → 279
 *   hot-pit         farm pays 121 FP = 1.5125 t — the farm down to ~12 tons
 *   the day's bill  ALERT-15 pulses (2) + the sortie (1)               → Fatigue 3
 *
 * (§12's per-minute speeds are superseded by D-038; its intercept geometry was already
 *  internally inconsistent — D-010.2. The FP ledger structure is the contract; the
 *  "JOKER at 36 hexes = 90" formula is verified in the module-1 table tests.)
 */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { rollDice } from '../../src/core/rng.js';
import { minFp } from '../../src/engine/air.js';
import { addFlight, baseTruth, gp, mkFacility } from '../helpers.js';
import type { BattleResult, Formation, Order, TruthState, Unit } from '../../src/core/types.js';

const SEED = 'M3-SHILONE-DAY';
const DAWN_OF_DAY = 60;

function buildScenario(): TruthState {
  const truth = baseTruth(SEED, [], 30, 22);
  // D-037 congruent sky: the airbase sits at ground (0,0), so Talon-2 launches into
  // air hex (0,0) and the SS12 intercept geometry reads exactly as written.
  truth.config.airHexByTheater = { 'theater-1': { q: 0, r: 0 } };

  // Blue: airbase (runway, 14-ton fuel farm), EW station on active sweep, HQ node
  truth.facilities['airbase'] = mkFacility({
    id: 'airbase', sideId: 'blue', name: 'Airbase Talon', pos: gp(0, 0),
    tags: ['AIRSTRIP'], fuelFarmTons: 14,
    turnaroundCrews: { total: 2, busyUntil: [] }, isCommandNode: true,
  });
  truth.sides['blue'].commandNodes = ['airbase'];
  truth.facilities['ew'] = mkFacility({
    id: 'ew', sideId: 'blue', name: 'EW Station', pos: gp(8, 5),
    tags: ['SENSOR_STATION'], sensorStation: { passive: 6, active: 12 },
    activeSweep: true,
  });

  // Talon-2: one SL-17 Shilone (65t, 6/9, 5 tons = 400 FP), with a crew
  const talon = addFlight(truth, {
    id: 'talon-2', sideId: 'blue', count: 1, klass: 'ASF',
    fp: 400, tons: 5, safeThrust: 6,
    basePos: gp(0, 0), homeFacilityId: 'airbase', withPilots: true,
  });
  truth.units[talon.unitIds[0]].model = 'SL-17 Shilone';

  // the ATO: sit the alert; if a contact closes within 4 air hexes, sweep-intercept it
  const standing: Order = {
    id: 'talon-ato', sideId: 'blue', formationId: 'talon-2',
    issuedTick: 0, effectiveTick: 0, kind: 'REST',
    conditionals: [{
      trigger: { when: 'CONTACT_WITHIN', param: 4 },
      thenOrder: { id: 'ph', sideId: 'blue', formationId: 'talon-2',
                   issuedTick: 0, effectiveTick: 0, kind: 'SWEEP',
                   targetContactId: 'contact:blue:bandit', airSpeed: 'DASH' } as Order,
    }],
  };
  truth.orders['talon-ato'] = standing;
  talon.currentOrderId = 'talon-ato';
  return truth;
}

/** The bandit: a recon pair that loiters over the theater taking photos, then runs east. */
function banditSpawn(c: Campaign): void {
  const truth = c.truth;
  const units: Unit[] = [0, 1].map(i => ({
    id: `bandit-${i}`, sideId: 'red', name: `Bandit ${i + 1}`, model: 'SB-27 Sabre',
    class: 'ASF' as const, bv: 800, pv: 20, walkOrCruise: 0, run: 0, jump: 0,
    safeThrust: 4, maxThrust: 6,
    fuel: { fp: 320, fpPerTon: 80, tons: 4 },
    damage: 'OK' as const, pilotIds: [], ammoState: 'FULL' as const, tags: [],
  }));
  const bandit: Formation = {
    id: 'bandit', sideId: 'red', name: 'Recon Pair', unitIds: units.map(u => u.id),
    pos: { kind: 'air', gridQ: -1, gridR: 0, band: 'HIGH', altLevel: 6, velocity: 2, vectorDeg: 0 },
    omp: 0, br: 16, sigBase: 8, sns: { passive: 1, active: 1 }, rdy: 10,
    emcon: 'PASSIVE', posture: 'NONE', onNet: true, standingOrderIds: [],
    supply: { lastSuppliedTick: 0, inSupply: true },
    air: { phase: 'ENROUTE', speed: 'CRUISE' },
  };
  c.spawnFormation(bandit, units);
  c.inject({ type: 'ORDER_ISSUED', order: {
    id: 'bandit-recon', sideId: 'red', formationId: 'bandit',
    issuedTick: truth.tick, effectiveTick: truth.tick, kind: 'RECON',
    station: { kind: 'air', gridQ: 0, gridR: 0, band: 'HIGH', altLevel: 6, velocity: 0, vectorDeg: 0 },
    loiterTicks: 1, airSpeed: 'DASH',
    path: [{ kind: 'air', gridQ: 200, gridR: 0, band: 'HIGH', altLevel: 6, velocity: 0, vectorDeg: 0 }],
    conditionals: [],
  } });
}

function fpOf(c: Campaign): number {
  return minFp(c.truth, c.truth.formations['talon-2']);
}

function runDay(c: Campaign) {
  // 0500: Talon-2 takes ALERT-15
  while (c.truth.tick < 50) c.step();
  expect(c.truth.tick).toBe(50);
  expect(c.setAlertState('talon-2', 'ALERT15').ok).toBe(true);

  // pre-dawn watch passes quietly; the bandit appears at the EW line at ~0850
  while (c.truth.tick < 88) c.step();
  banditSpawn(c);

  // run until the merge freezes the campaign
  let guard = 0;
  while (!c.pendingEngagement && guard++ < 400) c.step();
  return c.pendingEngagement;
}

describe('M3 acceptance — the Shilone day (SKYWATCH §12)', () => {
  it('flies the whole day tick-for-tick: 400 → 360 → 299 → 279 FP, farm to ~12 t, Fatigue 3',
      () => {
    const c = Campaign.create(buildScenario());
    const eng = runDay(c);

    // ── the scramble ──
    // the EW station earned SHADOW, the ATO conditional fired, and ALERT-15 put
    // Talon-2 in the air the contact turn after the call
    expect(eng).toBeTruthy();
    expect(eng!.domain).toBe('AIR');
    expect(eng!.attackerFormationIds).toEqual(['talon-2']);
    expect(eng!.defenderFormationIds).toEqual(['bandit']);
    const launched = c.store.all().find(l => l.event.type === 'AIR_LAUNCHED' &&
      (l.event as any).formationId === 'talon-2')!.event as any;
    const shadowTick = c.store.all().find(l => l.event.type === 'CONTACT_UPGRADED' &&
      (l.event as any).contact.id === 'contact:blue:bandit' &&
      (l.event as any).contact.level >= 2)!.event as any;
    expect(launched.tick).toBe(shadowTick.tick + 1); // "0900 SHADOW... 0901 takeoff"
    expect(launched.fpPaid).toBe(4 + 12);            // runway takeoff + climb to HIGH

    // ── the ledger to the merge: 400 − 16 − 24 = 360 ──
    // two contact turns of dash at 6 hexes / 12 FP each (D-038)
    const dashMoves = c.store.all().filter(l => l.event.type === 'AIR_MOVED' &&
      (l.event as any).formationId === 'talon-2' && (l.event as any).speed === 'DASH');
    expect(dashMoves).toHaveLength(2);
    for (const m of dashMoves) expect((m.event as any).fpPaid).toBe(12);
    expect(fpOf(c)).toBe(360);

    // ── the merge: map, vectors, energy, fuel (§7) ──
    const pkg = c.exportHandoff()!;
    expect(pkg.table).toBe('LOW_ALT_ATMO');          // HIGH band ⇒ low-altitude map
    const blue = pkg.perSide.find(p => p.sideId === 'blue')!;
    const red = pkg.perSide.find(p => p.sideId === 'red')!;
    expect(blue.units[0].fpOnTable).toBe(360);       // ledger rides on 1:1 (D-010.3)
    expect(blue.units[0].velocity).toBe(6);          // dash ⇒ Safe Thrust
    expect(pkg.specialRules).toContain('ENERGY:blue=12'); // velocity 6 + altitude 6
    expect(pkg.specialRules).toContain('ENERGY:red=10');  // the bandit ran at dash (ST 4)
    expect(pkg.specialRules.some(r => r.startsWith('HIGHER_ENERGY:blue'))).toBe(true);
    expect(red.units[0].fpOnTable).toBeLessThan(320); // the bandit paid for its run too

    // ── the table: 9 turns, 61 FP burned, the bandit's wing comes off ──
    const result: BattleResult = {
      handoffId: pkg.id, victorSideId: 'blue',
      unitOutcomes: [
        { unitId: 'talon-2-1', damage: 'OK', ammoState: 'PARTIAL',
          fpRemaining: 360 - 61, pilotOutcomes: [] },
        { unitId: 'bandit-0', damage: 'DESTROYED', ammoState: 'PARTIAL', pilotOutcomes: [] },
        { unitId: 'bandit-1', damage: 'DESTROYED', ammoState: 'PARTIAL', pilotOutcomes: [] },
      ],
      ejections: [{ pilotId: 'bandit-crew-1', pos: gp(12, 5) }], // DOWNED CREW: SAR seeded
      turnsElapsed: 9, notes: "bandit's wing torn off at turn 7",
    };
    expect(c.ingestBattleResult(result).ok).toBe(true);
    expect(fpOf(c)).toBe(299);
    expect(Object.values(c.truth.markers).some(m => m.kind === 'DOWNED_CREW')).toBe(true);
    expect(c.truth.formations['bandit'].destroyed).toBe(true);

    // ── RTB: the table released Talon-2 18 hexes from home (exit drift, §8.1) ──
    expect(c.repositionAir('talon-2', 18, 0).ok).toBe(true);
    let guard = 0;
    while (c.truth.formations['talon-2'].pos.kind === 'air' && guard++ < 50) c.step();
    expect(c.truth.formations['talon-2'].pos.kind).toBe('ground');
    const landed = c.store.all().filter(l => l.event.type === 'AIR_LANDED').at(-1)!.event as any;
    expect(landed.fpPaid).toBe(2);                   // runway landing
    expect(fpOf(c)).toBe(279);                       // 299 − 18 (cruise) − 2 (land)

    // ── hot-pit turnaround: the farm pays 121 FP and drops to ~12 tons ──
    const turn = c.turnaround('talon-2', 'HOT_PIT');
    expect(turn.ok).toBe(true);
    if (turn.ok) expect(turn.mishap).toBe(false);    // the seed is kind tonight
    expect(fpOf(c)).toBe(400);
    expect(c.truth.facilities['airbase'].fuelFarmTons).toBeCloseTo(14 - 121 / 80, 5);
    expect(Math.round(c.truth.facilities['airbase'].fuelFarmTons)).toBe(12); // down to ~12 t

    // ── the day's bill: Fatigue 3 (4 pulses of ALERT-15 + the sortie) ──
    expect(c.truth.pilots['talon-2-pilot-1'].fatigue).toBe(3);
  });

  it('the whole day is auditable: replay equality and re-derivable rolls', () => {
    const c = Campaign.create(buildScenario());
    const eng = runDay(c);
    expect(eng).toBeTruthy();
    const pkg = c.exportHandoff()!;
    c.ingestBattleResult({
      handoffId: pkg.id, victorSideId: 'blue',
      unitOutcomes: [
        { unitId: 'talon-2-1', damage: 'OK', ammoState: 'PARTIAL', fpRemaining: 179, pilotOutcomes: [] },
        { unitId: 'bandit-0', damage: 'DESTROYED', ammoState: 'DRY', pilotOutcomes: [] },
        { unitId: 'bandit-1', damage: 'DESTROYED', ammoState: 'DRY', pilotOutcomes: [] },
      ],
      ejections: [], turnsElapsed: 9, notes: '',
    });
    c.repositionAir('talon-2', 18, 0);
    for (let i = 0; i < 20 && c.truth.formations['talon-2'].pos.kind === 'air'; i++) c.step();
    c.turnaround('talon-2', 'HOT_PIT');
    for (let i = 0; i < 5; i++) c.step();

    expect(replay(c.store.all())).toEqual(c.truth);
    for (const l of c.store.all()) {
      if (l.event.type === 'DIE_ROLLED') {
        expect(rollDice(SEED, l.event.roll.seedCursor, l.event.roll.dice).result)
          .toBe(l.event.roll.result);
      }
    }
  });
});
