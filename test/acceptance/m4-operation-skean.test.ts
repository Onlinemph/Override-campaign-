/**
 * M4 acceptance — Operation SKEAN (DEEP SKY §9.1), per the spec build plan:
 *
 *   - the jump flash reaches the planet 83 minutes after a 10 AU arrival;
 *   - the cold-coast detachment stays SIG 11 until the gas-giant picket's active sweep;
 *   - the classifier returns MATCHED with ~2.1 burn-days of margin.
 *
 * Geometry (a G2V system): zenith —10 AU— planet; zenith —4 AU— gas giant. The
 * detachment kicks at 0.5G for ~1 day (below the 1G auto-detect line: "detached
 * cold"), then coasts at ~1695 kps toward the giant, arriving in range of the picket's
 * sweep around W20. The picket (pocket WarShip, 2G, 3.05 burn-days in the bunkers) has
 * MM 6.1 against a 2.0 burn-day velocity gap: MATCHED, margin 2.1.
 */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { rollDice } from '../../src/core/rng.js';
import { emitJumpFlash, lightLagMinutes, lightLagTicks } from '../../src/engine/space.js';
import { CLOCK, DEEPSKY } from '../../src/rules.js';
import { addSystem, addVessel, baseTruth, gp, mkFacility } from '../helpers.js';
import type { Formation, LanePos, Order, TruthState, Unit } from '../../src/core/types.js';
import type { GameEvent } from '../../src/core/events.js';

const SEED = 'M4-SKEAN-9'; // chosen so the dark approach stays dark until the in-close sweep (D-011)
const W = CLOCK.TICKS_PER_WATCH;

function buildSystem(): TruthState {
  const truth = baseTruth(SEED, [], 20, 14);
  addSystem(truth, [
    { id: 'zenith', type: 'JUMP_ZENITH', name: 'Zenith Point' },
    { id: 'planet', type: 'PLANET', name: 'Cavanaugh II', theaterId: 'theater-1' },
    { id: 'giant', type: 'GAS_GIANT', name: 'Mistral' },
    { id: 'l1', type: 'PIRATE_POINT', name: 'Cavanaugh L1', secret: true },
  ], [['zenith', 'planet', 10], ['zenith', 'giant', 4], ['giant', 'planet', 8]]);

  // Defender (blue): planetside presence (the observer the 83 minutes are measured to)
  // and the picket at the gas giant — active bubble, full bunkers for a 2G hull.
  truth.facilities['planet-hq'] = mkFacility({
    id: 'planet-hq', sideId: 'blue', name: 'Planetary Command', pos: gp(5, 5),
    tags: ['SPACEPORT'], isCommandNode: true,
  });
  addVessel(truth, { id: 'picket', sideId: 'blue', nodeId: 'giant',
                     tons: 5.612, tonsPerBurnDay: 1.84, maxThrust: 4, emcon: 'ACTIVE' });
  return truth;
}

/** W0: the attacker jumps in at zenith — one Invader and four DropShip masses. */
function jumpIn(c: Campaign): void {
  const mk = (id: string, klass: 'JUMPSHIP' | 'DROPSHIP', tons: number): Unit => ({
    id, sideId: 'red', name: id, model: klass, class: klass, bv: 0, pv: 0,
    walkOrCruise: 0, run: 0, jump: 0, maxThrust: klass === 'JUMPSHIP' ? 0.2 : 4,
    fuel: { fp: 0, fpPerTon: 30, tons, tonsPerBurnDay: 1.84 },
    damage: 'OK', pilotIds: [], ammoState: 'FULL', tags: [],
  });
  const fleet: Formation = {
    id: 'red-fleet', sideId: 'red', name: 'Invasion Fleet', unitIds: ['invader-1'],
    pos: { kind: 'node', nodeId: 'zenith' }, omp: 0, br: 100, sigBase: 8,
    sns: { passive: 1, active: 1 }, rdy: 10, emcon: 'PASSIVE', posture: 'NONE',
    onNet: true, standingOrderIds: [], supply: { lastSuppliedTick: 0, inSupply: true },
  };
  const main: Formation = { ...structuredClone(fleet), id: 'red-main', name: 'Assault Element',
    unitIds: ['main-1', 'main-2'] };
  const ghosts: Formation = { ...structuredClone(fleet), id: 'red-coasters', name: 'Cold Detachment',
    unitIds: ['ghost-1', 'ghost-2'] };

  c.spawnFormation(fleet, [mk('invader-1', 'JUMPSHIP', 50)], []);
  c.spawnFormation(main, [mk('main-1', 'DROPSHIP', 150), mk('main-2', 'DROPSHIP', 150)], []);
  c.spawnFormation(ghosts, [mk('ghost-1', 'DROPSHIP', 80), mk('ghost-2', 'DROPSHIP', 80)], []);

  // the K-F flash announces all of it, system-wide, after light lag (§4.1)
  const events: GameEvent[] = [];
  emitJumpFlash(c.truth, e => events.push(e), c.truth.formations['red-fleet'], 'zenith');
  for (const e of events) c.inject(e);

  // W1+: two DropShips burn 1G for the planet — arrival vector public
  c.inject({ type: 'ORDER_ISSUED', order: {
    id: 'main-burn', sideId: 'red', formationId: 'red-main', issuedTick: c.truth.tick,
    effectiveTick: c.truth.tick, kind: 'TRANSIT', laneId: 'zenith--planet',
    burnProfile: { g: 1 }, conditionals: [] } as Order });
  // ...and two more aren't burning: a 0.5G kick for ~4 days, then the long dark drift
  c.inject({ type: 'ORDER_ISSUED', order: {
    id: 'ghost-coast', sideId: 'red', formationId: 'red-coasters', issuedTick: c.truth.tick,
    effectiveTick: c.truth.tick, kind: 'COLD_COAST', laneId: 'zenith--giant',
    burnProfile: { g: 0.5, coastFromAU: 1.95 }, conditionals: [] } as Order });
}

describe('M4 acceptance — Operation SKEAN', () => {
  it('W0: the flash is seen planetside 83 minutes later (10 AU light lag)', () => {
    expect(lightLagMinutes(10)).toBe(83);
    expect(lightLagTicks(10)).toBe(14); // nearest 6-minute tick: delivered from t14

    const c = Campaign.create(buildSystem());
    jumpIn(c);
    c.step(); // the light is in flight
    c.step(); // the watch boundary at t60 carries it onto every scope

    const em = Object.values(c.truth.emissions).find(e => e.kind === 'JUMP_FLASH')!;
    expect(em.observedBy).toContain('blue');
    const contact = c.truth.contacts['contact:blue:red-fleet'];
    expect(contact).toBeTruthy();
    expect(contact.level).toBe(2);              // a jump occurred; rough mass class
    expect(contact.staleAsOfTick).toBe(0);      // when it was TRUE — the light-cone view
    const flashReport = Object.values(c.truth.reports).find(r =>
      r.sideId === 'blue' && r.text.includes('JumpShip-class mass'));
    expect(flashReport).toBeTruthy();
    // at Watch scale the flash is one Watch stale when it lands (§4.2)
    expect(flashReport!.deliveredTick).toBe(CLOCK.TICKS_PER_WATCH);
    expect(flashReport!.deliveredTick! - contact.staleAsOfTick).toBe(CLOCK.TICKS_PER_WATCH);
  });

  it('W1–W20: burners are public, the cold detachment stays SIG 11 until the picket sweep, ' +
     'and the classifier returns MATCHED with ~2.1 burn-days of margin', () => {
    const c = Campaign.create(buildSystem());
    jumpIn(c);

    // run the system war at watch pace until the picket resolves the coasters
    let resolvedTick: number | null = null;
    let guard = 0;
    while (resolvedTick === null && guard++ < 120) {
      c.step();
      if (c.truth.contacts['contact:blue:red-coasters']) resolvedTick = c.truth.tick;
      else {
        // double-blind holds: the defender's map shows burners, never the ghosts
        expect(Object.values(c.truth.contacts).every(k =>
          !(k.observerSideId === 'blue' && k.targetFormationId === 'red-coasters'))).toBe(true);
      }
    }

    // the main element was on every scope (1G+ = automatic after light lag)...
    expect(c.truth.contacts['contact:blue:red-main']).toBeTruthy();
    expect(c.truth.contacts['contact:blue:red-main'].level).toBe(2);

    // ...and the ghosts were finally resolved — by the picket's active sweep, in close
    expect(resolvedTick).not.toBeNull();
    expect(resolvedTick!).toBeGreaterThanOrEqual(16 * W); // the long quiet approach
    expect(resolvedTick!).toBeLessThanOrEqual(25 * W);    // ...ends near the giant
    const resolvingRoll = c.store.all().map(l => l.event).filter(e =>
      e.type === 'DIE_ROLLED' &&
      (e as { roll: { purpose: string } }).roll.purpose.includes('→ Cold Detachment')).at(-1) as
      { roll: { purpose: string } };
    expect(resolvingRoll.roll.purpose).toContain(`TN ${DEEPSKY.COLD_COAST_SIG}`); // SIG 11 flat
    expect(resolvingRoll.roll.purpose).toContain('picket sweep');                 // −2 in close

    // the geometry solution: MATCHED with ~2.1 burn-days of margin
    const coasterPos = c.truth.formations['red-coasters'].pos as LanePos;
    expect(coasterPos.kind).toBe('lane');
    expect(coasterPos.velocityKps).toBeCloseTo(847.3 * 2 * 1, -1); // one 2G-day of ΔV banked
    const cls = c.classifyEncounter('picket', 'red-coasters');
    expect('type' in cls && cls.type).toBe('MATCHED');
    if ('marginBurnDays' in cls) {
      expect(cls.mm).toBeCloseTo(6.1, 1);
      expect(cls.gapBurnDays).toBeCloseTo(2.0, 1);
      expect(cls.marginBurnDays).toBeGreaterThanOrEqual(2.0);
      expect(cls.marginBurnDays).toBeLessThanOrEqual(2.2);   // "~2.1 burn-days of margin"
    }

    // commit: the system war begins — picket vs an assault DropShip full of marines
    const made = c.createSpaceEngagement('picket', 'red-coasters');
    expect(made.ok).toBe(true);
    const pkg = c.exportHandoff()!;
    expect(pkg.table).toBe('SPACE');
    expect(pkg.specialRules).toContain('MATCHED');
    expect(pkg.specialRules.some(r => r.startsWith('MARGIN:2.1'))).toBe(true);
    expect(pkg.specialRules).toContain('BOARDING_POSSIBLE_IF_CRIPPLED');
    // tactical FP from the burn-day ledger: tons × 30 at the handoff (§3, §6)
    const picketUnit = pkg.perSide.find(p => p.sideId === 'blue')!.units[0];
    expect(picketUnit.fpOnTable).toBe(Math.round(5.612 * 30));
    // intel = initiative (§6): the picket's light on the coasters is at least as fresh
    // as anything the coasters scraped off a station-keeping picket across the gap
    const blueSide = pkg.perSide.find(p => p.sideId === 'blue')!;
    const redSide = pkg.perSide.find(p => p.sideId === 'red')!;
    expect(blueSide.initiativeBonus).toBeGreaterThanOrEqual(redSide.initiativeBonus);
  });

  it('the whole invasion is auditable: byte-exact replay, every roll re-derivable', () => {
    const c = Campaign.create(buildSystem());
    jumpIn(c);
    let guard = 0;
    while (!c.truth.contacts['contact:blue:red-coasters'] && guard++ < 120) c.step();
    c.createSpaceEngagement('picket', 'red-coasters');
    const pkg = c.exportHandoff()!;
    c.ingestBattleResult({
      handoffId: pkg.id, victorSideId: 'blue',
      unitOutcomes: [
        { unitId: 'ghost-1', damage: 'CRIPPLED', ammoState: 'PARTIAL', pilotOutcomes: [] },
        { unitId: 'picket-1', damage: 'DAMAGED', ammoState: 'PARTIAL',
          fpRemaining: 120, pilotOutcomes: [] },
      ],
      ejections: [], turnsElapsed: 12, notes: 'the refinery holds',
    });
    for (let i = 0; i < 10; i++) c.step();

    expect(replay(c.store.all())).toEqual(c.truth);
    for (const l of c.store.all()) {
      if (l.event.type === 'DIE_ROLLED') {
        expect(rollDice(SEED, l.event.roll.seedCursor, l.event.roll.dice).result)
          .toBe(l.event.roll.result);
      }
    }
    // the picket's tabletop fuel came home to the strategic ledger: 120 FP ÷ 30 = 4 t
    expect(c.truth.units['picket-1'].fuel!.tons).toBe(4);
  });
});
