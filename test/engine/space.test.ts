/** M4 — the system war engine: lanes, light lag, classifier, jump board (DEEP SKY). */
import { describe, expect, it } from 'vitest';
import { Campaign } from '../../src/core/truth.js';
import {
  classifyEncounter, kpsFromBurn, lightLagTicks, nodeDistanceAU, positionDistanceAU,
  transitDays,
} from '../../src/engine/space.js';
import { rollDice } from '../../src/core/rng.js';
import { CLOCK, DEEPSKY } from '../../src/rules.js';
import { addSystem, addVessel, baseTruth } from '../helpers.js';
import type { LanePos, Order, TruthState } from '../../src/core/types.js';

function solSystem(truth: TruthState): void {
  addSystem(truth, [
    { id: 'zenith', type: 'JUMP_ZENITH' },
    { id: 'planet', type: 'PLANET', theaterId: 'theater-1' },
    { id: 'giant', type: 'GAS_GIANT' },
    { id: 'l1', type: 'PIRATE_POINT', secret: true },
  ], [['zenith', 'planet', 10], ['zenith', 'giant', 4], ['giant', 'planet', 8]]);
}

function transitOrder(id: string, formationId: string, laneId: string,
                      extra: Partial<Order> = {}): Order {
  return { id, sideId: 'red', formationId, issuedTick: 0, effectiveTick: 0,
           kind: 'TRANSIT', laneId, conditionals: [], ...extra };
}

describe('M4 — geometry', () => {
  it('lane-graph distances: direct, multi-hop, and along-lane positions', () => {
    const truth = baseTruth();
    solSystem(truth);
    expect(nodeDistanceAU(truth, 'zenith', 'planet')).toBe(10);
    expect(nodeDistanceAU(truth, 'planet', 'giant')).toBe(8);
    expect(nodeDistanceAU(truth, 'zenith', 'zenith')).toBe(0);
    const lanePos: LanePos = { kind: 'lane', laneId: 'zenith--planet', progressAU: 3,
                               velocityKps: 0, burnProfile: { g: 1 }, flipped: false };
    expect(positionDistanceAU(truth, lanePos, { kind: 'node', nodeId: 'zenith' })).toBe(3);
    expect(positionDistanceAU(truth, lanePos, { kind: 'node', nodeId: 'planet' })).toBe(7);
  });
  it('light lag: 10 AU = 83 min = 14 ticks (nearest 6-min tick)', () => {
    expect(lightLagTicks(10)).toBe(14);
    expect(lightLagTicks(0.01)).toBe(1); // never instantaneous
  });
});

describe('M4 — the burn (standard profile)', () => {
  it('a 1G flip-at-midpoint transit arrives at rest in ~brachistochrone time, paying tons', () => {
    const truth = baseTruth('SPACE-TRANSIT');
    solSystem(truth);
    const ship = addVessel(truth, { id: 'ship', sideId: 'red', nodeId: 'zenith', tons: 150 });
    truth.orders['t'] = transitOrder('t', 'ship', 'zenith--planet',
      { burnProfile: { g: 1, flipAtAU: 5 } });
    ship.currentOrderId = 't';
    const c = Campaign.create(truth);

    let guard = 0;
    while (c.truth.formations['ship'].pos.kind !== 'node' ||
           (c.truth.formations['ship'].pos as { nodeId: string }).nodeId !== 'planet') {
      c.step();
      if (guard++ > 5000) break;
    }
    const days = c.truth.tick / CLOCK.TICKS_PER_DAY;
    expect(days).toBeGreaterThan(transitDays(10, 1) * 0.95);
    expect(days).toBeLessThan(transitDays(10, 1) * 1.15);
    // fuel: ~1.84 t/day × ~9 days of thrusting
    const burned = 150 - c.truth.units['ship-1'].fuel!.tons;
    expect(burned).toBeGreaterThan(1.84 * days * 0.9);
    expect(burned).toBeLessThan(1.84 * days * 1.1);
    expect(c.truth.orders['t'].completed).toBe(true);
  });

  it('burning at 1G+ is automatic, after light lag: the enemy reads your vector', () => {
    const truth = baseTruth('SPACE-BURNWATCH');
    solSystem(truth);
    addVessel(truth, { id: 'watcher', sideId: 'blue', nodeId: 'planet' });
    const ship = addVessel(truth, { id: 'burner', sideId: 'red', nodeId: 'zenith' });
    truth.orders['t'] = transitOrder('t', 'burner', 'zenith--planet', { burnProfile: { g: 1 } });
    ship.currentOrderId = 't';
    const c = Campaign.create(truth);

    let guard = 0;
    while (!c.truth.contacts['contact:blue:burner'] && guard++ < 6) c.step();
    const contact = c.truth.contacts['contact:blue:burner'];
    expect(contact).toBeTruthy();
    expect(contact.level).toBe(DEEPSKY.EMISSION_CONTACT_LEVEL);
    expect(contact.staleAsOfTick).toBeLessThan(c.truth.tick); // light-cone, not truth
    const report = Object.values(c.truth.reports).find(r => r.sideId === 'blue');
    expect(report?.text).toContain('arrival time and destination computable');
  });

  it('military burns wear the crew: 2G costs −1 RDY per day', () => {
    const truth = baseTruth('SPACE-CREW');
    solSystem(truth);
    const ship = addVessel(truth, { id: 'ship', sideId: 'red', nodeId: 'zenith', tons: 400 });
    truth.orders['t'] = transitOrder('t', 'ship', 'zenith--planet', { burnProfile: { g: 2 } });
    ship.currentOrderId = 't';
    const c = Campaign.create(truth);
    while (c.truth.tick < 2 * CLOCK.TICKS_PER_DAY) c.step(); // two days of 2G
    expect(c.truth.formations['ship'].rdy).toBe(8);
  });

  it('cold coast: a sub-1G kick then ballistic drift — no plume, near-zero fuel', () => {
    const truth = baseTruth('SPACE-COAST');
    solSystem(truth);
    addVessel(truth, { id: 'watcher', sideId: 'blue', nodeId: 'planet' });
    const ship = addVessel(truth, { id: 'ghost', sideId: 'red', nodeId: 'zenith', tons: 80 });
    truth.orders['t'] = { ...transitOrder('t', 'ghost', 'zenith--giant'),
                          kind: 'COLD_COAST', burnProfile: { g: 0.5, coastFromAU: 0.4 } };
    ship.currentOrderId = 't';
    const c = Campaign.create(truth);
    while (c.truth.tick < 3 * CLOCK.TICKS_PER_DAY) c.step();

    const pos = c.truth.formations['ghost'].pos as LanePos;
    expect(pos.kind).toBe('lane');
    expect(pos.velocityKps).toBeGreaterThan(0);
    // sub-1G kicks stay under the auto-detect threshold: no drive-burn emissions
    expect(Object.values(c.truth.emissions).filter(e => e.kind === 'DRIVE_BURN')).toHaveLength(0);
    // coasting costs nothing: only the kick burned tons (≤ ~2 days of 0.5G with
    // watch-step quantization), nothing like 3 days of sustained thrust
    const burned = 80 - c.truth.units['ghost-1'].fuel!.tons;
    expect(burned).toBeLessThanOrEqual(1.84 * 0.5 * 2.1);
    expect(burned).toBeLessThan(1.84 * 0.5 * 3);
    // and the watcher's rolls against the coaster were at the flat SIG 11
    for (const l of c.store.all()) {
      if (l.event.type === 'DIE_ROLLED' &&
          l.event.roll.purpose.includes('space detection') &&
          l.event.roll.purpose.includes('→ ghost')) {
        expect(l.event.roll.purpose).toContain(`TN ${DEEPSKY.COLD_COAST_SIG}`);
      }
    }
  });
});

describe('M4 — the encounter classifier (DEEP SKY §5)', () => {
  function classifierFixture() {
    const truth = baseTruth('SPACE-CLASSIFY');
    solSystem(truth);
    return truth;
  }
  const onLane = (truth: TruthState, id: string, v: number, progress = 2): void => {
    truth.formations[id].pos = { kind: 'lane', laneId: 'zenith--giant', progressAU: progress,
                                 velocityKps: v, burnProfile: { g: 1 }, flipped: false };
  };

  it('BLOCKADE: both at rest at the same node', () => {
    const truth = classifierFixture();
    const a = addVessel(truth, { id: 'a', sideId: 'blue', nodeId: 'giant' });
    const b = addVessel(truth, { id: 'b', sideId: 'red', nodeId: 'giant' });
    expect(classifyEncounter(truth, a, b).type).toBe('BLOCKADE');
  });

  it('MATCHED: interceptor MM ≥ 2 × gap, margin reported in burn-days', () => {
    const truth = classifierFixture();
    const picket = addVessel(truth, { id: 'p', sideId: 'blue', nodeId: 'giant',
                                      tons: 5.612, maxThrust: 4 }); // 3.05 bd × 2G = 6.1 MM
    const coaster = addVessel(truth, { id: 'x', sideId: 'red', nodeId: 'zenith' });
    onLane(truth, 'x', kpsFromBurn(1, 2)); // one day of 2G: gap = 2.0 burn-days
    const c = classifyEncounter(truth, picket, coaster);
    expect(c.type).toBe('MATCHED');
    expect(c.mm).toBeCloseTo(6.1, 2);
    expect(c.gapBurnDays).toBeCloseTo(2.0, 2);
    expect(c.marginBurnDays).toBeCloseTo(2.1, 2);
  });

  it('SLASH: can reach the path but not match velocity', () => {
    const truth = classifierFixture();
    const picket = addVessel(truth, { id: 'p', sideId: 'blue', nodeId: 'giant',
                                      tons: 2.024, maxThrust: 2 }); // 1.1 bd × 1G = 1.1 MM
    const runner = addVessel(truth, { id: 'x', sideId: 'red', nodeId: 'zenith' });
    onLane(truth, 'x', kpsFromBurn(1, 2)); // gap 2.0: 1.1 < 4 but ≥ 1.0 ⇒ slash
    expect(classifyEncounter(truth, picket, runner).type).toBe('SLASH');
  });

  it('STERN_CHASE: behind on the same lane, faster, but cannot null the gap', () => {
    const truth = classifierFixture();
    const hound = addVessel(truth, { id: 'h', sideId: 'blue', nodeId: 'giant',
                                     tons: 0.3, maxThrust: 2 }); // nearly dry: MM 0.163
    const hare = addVessel(truth, { id: 'x', sideId: 'red', nodeId: 'zenith' });
    onLane(truth, 'x', 400, 2.5);
    onLane(truth, 'h', 900, 1.0); // behind, overtaking, gap 0.59 bd > MM coverage
    const c = classifyEncounter(truth, hound, hare);
    expect(c.type).toBe('STERN_CHASE');
    expect(c.overtakeNote).toContain('overtake');
  });

  it('NO_ENGAGEMENT: a dry interceptor reports a near-miss (GM eyes only)', () => {
    const truth = classifierFixture();
    const dry = addVessel(truth, { id: 'p', sideId: 'blue', nodeId: 'planet', tons: 0.1 });
    const fast = addVessel(truth, { id: 'x', sideId: 'red', nodeId: 'zenith' });
    onLane(truth, 'x', 2000);
    expect(classifyEncounter(truth, dry, fast).type).toBe('NO_ENGAGEMENT');
  });
});

describe('M4 — the jump board (DEEP SKY §7)', () => {
  function board(seed: string) {
    const truth = baseTruth(seed);
    solSystem(truth);
    addVessel(truth, { id: 'js', sideId: 'red', nodeId: 'zenith', klass: 'JUMPSHIP',
                       withDrive: { chargePct: 0, sail: 'DEPLOYED', chargeRateHrsTo100: 180 } });
    return Campaign.create(truth);
  }

  it('a deployed sail recharges at the star-class rate (~30 watches in a Sol system)', () => {
    const c = board('JUMP-CHARGE');
    while (c.truth.tick < 15 * CLOCK.TICKS_PER_WATCH) c.step(); // 90 hours
    expect(c.truth.jumpDrives['js-1'].chargePct).toBeCloseTo(50, 0);
    while (c.truth.jumpDrives['js-1'].chargePct < 100 && c.truth.tick < 5000) c.step();
    const watches = c.truth.tick / CLOCK.TICKS_PER_WATCH;
    expect(watches).toBeGreaterThanOrEqual(30);   // 180 hrs = 30 watches in a Sol system
    expect(watches).toBeLessThanOrEqual(31);      // (step quantization)
  });

  it('a vessel under sail cannot start a transit', () => {
    const c = board('JUMP-SAIL');
    c.inject({ type: 'ORDER_ISSUED', order: transitOrder('t', 'js', 'zenith--planet') });
    c.step(); c.step();
    expect(c.truth.formations['js'].pos.kind).toBe('node'); // pinned under canvas
  });

  it('a jump needs 100% (or an L-F battery), spends it, and the flash announces you', () => {
    const c = board('JUMP-GO');
    expect(c.executeJump('js', 'planet').ok).toBe(false); // 0% and no battery
    c.inject({ type: 'JUMP_CHARGE', unitId: 'js-1', chargePct: 100 });
    c.inject({ type: 'SAIL_CHANGED', unitId: 'js-1', sail: 'STOWED', tick: c.truth.tick });
    const r = c.executeJump('js', 'planet');
    expect(r.ok).toBe(true);
    expect((c.truth.formations['js'].pos as { nodeId: string }).nodeId).toBe('planet');
    expect(c.truth.jumpDrives['js-1'].chargePct).toBe(0);
    expect(Object.values(c.truth.emissions).some(e => e.kind === 'JUMP_FLASH')).toBe(true);
  });

  it('pirate points stay locked until surveyed; the throw is logged', () => {
    const c = board('JUMP-PIRATE');
    c.inject({ type: 'JUMP_CHARGE', unitId: 'js-1', chargePct: 100 });
    c.inject({ type: 'SAIL_CHANGED', unitId: 'js-1', sail: 'STOWED', tick: c.truth.tick });
    expect(c.executeJump('js', 'l1').ok).toBe(false); // solution unknown
    c.surveyNode('l1', 'red');
    const r = c.executeJump('js', 'l1');
    // surveyed: 2d6 vs 7, ≤4 misjumps — whatever the seed rolled, it is in the log
    const throwRoll = c.store.all().map(l => l.event)
      .filter(e => e.type === 'DIE_ROLLED' && e.roll.purpose.includes('pirate point'));
    expect(throwRoll).toHaveLength(1);
    if (r.ok && !r.misjump) {
      expect((c.truth.formations['js'].pos as { nodeId: string }).nodeId).toBe('l1');
    }
  });

  it('emergency furl risks the charge; quick-charge risks the drive (logged rolls)', () => {
    // seed-hunt both failure branches so they are exercised deterministically
    let furlLost: Campaign | null = null;
    let quickHurt: Campaign | null = null;
    for (let i = 0; i < 300 && (!furlLost || !quickHurt); i++) {
      const probe = board(`JUMP-RISK-${i}`);
      const first = rollDice(`JUMP-RISK-${i}`, probe.truth.seedCursor, '2d6').result;
      if (!furlLost && first <= DEEPSKY.JUMP.EMERGENCY_FURL.LOSE_CHARGE_MAX) furlLost = probe;
      else if (!quickHurt && first <= DEEPSKY.JUMP.QUICK_CHARGE.KF_DAMAGE_MAX) quickHurt = probe;
    }
    expect(furlLost).toBeTruthy();
    furlLost!.inject({ type: 'JUMP_CHARGE', unitId: 'js-1', chargePct: 60 });
    const furl = furlLost!.emergencyFurlSail('js-1');
    expect(furl.ok).toBe(true);
    expect(furl.chargeLost).toBe(true);
    expect(furlLost!.truth.jumpDrives['js-1'].chargePct).toBe(0);
    expect(furlLost!.truth.jumpDrives['js-1'].sail).toBe('STOWED');

    expect(quickHurt).toBeTruthy();
    const qc = quickHurt!.quickCharge('js-1');
    expect(qc.ok).toBe(true);
    expect(qc.kfDamaged).toBe(true);
    expect(quickHurt!.truth.jumpDrives['js-1'].kfDamage).toBe('MINOR');
  });

  it('killing a JumpShip invokes the taboo: −10 VP and a Reprisal owed', () => {
    const truth = baseTruth('JUMP-TABOO');
    solSystem(truth);
    const js = addVessel(truth, { id: 'js', sideId: 'red', nodeId: 'zenith', klass: 'JUMPSHIP' });
    const raider = addVessel(truth, { id: 'raider', sideId: 'blue', nodeId: 'zenith',
                                      maxThrust: 4, tons: 40 });
    const c = Campaign.create(truth);
    const made = c.createSpaceEngagement('raider', 'js');
    expect(made.ok).toBe(true);
    const pkg = c.exportHandoff()!;
    c.ingestBattleResult({
      handoffId: pkg.id, victorSideId: 'blue',
      unitOutcomes: [{ unitId: 'js-1', damage: 'DESTROYED', ammoState: 'DRY', pilotOutcomes: [] }],
      ejections: [], turnsElapsed: 4, notes: 'the taboo broken',
    });
    expect(c.truth.sides['blue'].vp).toBe(DEEPSKY.TABOO.JUMPSHIP_KILL_VP);
    expect(c.truth.sides['red'].reprisalsOwed).toBe(1);
  });
});

describe('M4 — skimming the giant (DEEP SKY §3)', () => {
  it('a DropShip at a gas giant scoops 1d6×10 tons per watch behind a piloting check', () => {
    const truth = baseTruth('SPACE-SKIM');
    solSystem(truth);
    const ship = addVessel(truth, { id: 'tanker', sideId: 'blue', nodeId: 'giant', tons: 10 });
    truth.orders['skim'] = { id: 'skim', sideId: 'blue', formationId: 'tanker',
      issuedTick: 0, effectiveTick: 0, kind: 'SKIM_FUEL', conditionals: [] };
    ship.currentOrderId = 'skim';
    const c = Campaign.create(truth);
    while (c.truth.tick < 4 * CLOCK.TICKS_PER_WATCH) c.step();
    const gained = c.truth.units['tanker-1'].fuel!.tons - 10;
    const yields = c.store.all().map(l => l.event)
      .filter(e => e.type === 'DIE_ROLLED' && e.roll.purpose.includes('skim yield'));
    expect(yields.length).toBeGreaterThan(0);
    expect(gained).toBe(yields.reduce((sum, e: any) => sum + e.roll.result * 10, 0));
  });
});
