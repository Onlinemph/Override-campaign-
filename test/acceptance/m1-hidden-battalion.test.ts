/**
 * Group C — Milestone 1 acceptance test (spec Build Plan, M1):
 *
 *   "Scripted two-side scenario — a hidden battalion (DARK, woods, night) crosses a
 *    sensor line; verify TN math (SIG 5+2+1+2+2=12 ⇒ effectively invisible) and report
 *    delivery only when scout returns on-net."
 *
 * TN decomposition per GM ruling D-006: battalion 5 + cautious move +2 + EMCON DARK +2
 * + woods +1 + night +2 = 12.
 *
 * Timeline (dawn = tick 60):
 *   t0–~50  night: the battalion creeps west through the woods across the sensor
 *           station's coverage. Every station roll is logged at TN 12; none connect.
 *   ~t50    battalion reaches its lay-up hex and goes to HIDE. Blue scout (plotted
 *           patrol, beyond net radius) goes ACTIVE at its station.
 *   t60+    daylight: the scout resolves the hide site, climbing the ladder. All its
 *           reports are HELD — it is off-net.
 *   t90     scout's plotted RTB executes; on re-entering the command radius its report
 *           stack delivers with original timestamps. Only now does Blue's map change.
 */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { computeDetectionTN } from '../../src/engine/detection.js';
import { project } from '../../src/projection/project.js';
import { rollDice } from '../../src/core/rng.js';
import { mkFacility } from '../../src/fixtures.js';
import { addMechFormation, baseTruth, gp, moveOrder, T } from '../helpers.js';
import type { TruthState } from '../../src/core/types.js';

const SEED = 'M1-ACCEPTANCE';
const DAWN = 60;

function buildScenario(): TruthState {
  const woods = [
    // the crossing corridor along r=8 and the approach to the lay-up site
    ...Array.from({ length: 15 }, (_, i) => ({ q: 10 + i, r: 8, terrain: 'WOODS' as const })),
    { q: 14, r: 6, terrain: 'WOODS' as const },
    { q: 13, r: 6, terrain: 'WOODS' as const },
    { q: 12, r: 6, terrain: 'WOODS' as const },
    { q: 13, r: 7, terrain: 'WOODS' as const },
  ];
  const truth = baseTruth(SEED, woods, 30, 22);

  // ── Blue (defender) ──
  const hq = addMechFormation(truth, { id: 'blue-hq', sideId: 'blue', pos: gp(0, 19), sigBase: 6 });
  truth.sides['blue'].commandNodes = [hq.id];
  truth.facilities['blue-station'] = mkFacility({
    id: 'blue-station', sideId: 'blue', name: 'Sensor Station Echo',
    pos: gp(18, 12), tags: ['SENSOR_STATION'],
    sensorStation: { passive: 6, active: 12 },
  });
  const scout = addMechFormation(truth,
    { id: 'blue-scout', sideId: 'blue', pos: gp(4, 16), omp: 8, sigBase: 7,
      sns: { passive: 4, active: 8 } });
  // plotted mission, filed before the op (the scout will be off-net out there):
  truth.orders['s1'] = moveOrder('s1', scout, 'MOVE',
    [gp(7, 14), gp(10, 11), gp(12, 9), gp(13, 8), gp(13, 7)], 0);
  // active sweep begins at DAWN: an active sensor ignores the night modifier (D-006),
  // so sweeping earlier would cheat the battalion out of its TN-12 night
  truth.orders['s2'] = { ...moveOrder('s2', scout, 'PATROL', [], DAWN),
                         emconOverride: 'ACTIVE' as const, station: gp(13, 7) };
  truth.orders['s3'] = moveOrder('s3', scout, 'MOVE',
    [gp(10, 11), gp(7, 14), gp(4, 17), gp(2, 18)], 90);

  // ── Red (attacker): the hidden battalion ──
  // omp 5 at the 18 km scale ⇒ ~2.5 hex/pulse cautious cross-country — the same crossing
  // pace the scenario was written around (was omp 1 under the old ×5 pulse multiplier)
  const bn = addMechFormation(truth,
    { id: 'red-bn', sideId: 'red', pos: gp(24, 8), omp: 5, sigBase: 5, emcon: 'DARK' },
    12, {});
  truth.orders['b1'] = moveOrder('b1', bn, 'MOVE_CAUTIOUS', [
    gp(23, 8), gp(22, 8), gp(21, 8), gp(20, 8), gp(19, 8), gp(18, 8), gp(17, 8),
    gp(16, 8), gp(15, 8), gp(14, 8), gp(14, 7), gp(13, 6), gp(12, 6),
  ], 0);
  truth.orders['b2'] = moveOrder('b2', bn, 'HIDE', [], 55);
  return truth;
}

function blueContacts(truth: TruthState) {
  return Object.values(truth.contacts).filter(c => c.observerSideId === 'blue');
}

function runTo(campaign: Campaign, tick: number) {
  while (campaign.truth.tick < tick) campaign.step();
}

describe('M1 acceptance — the hidden battalion', () => {
  it('crossing TN is exactly 12 = battalion 5 + cautious 2 + DARK 2 + woods 1 + night 2', () => {
    const campaign = Campaign.create(buildScenario());
    // step until the battalion has moved at least once (transient CAUTIOUS set) at night
    while (campaign.truth.formations['red-bn'].transient?.moved !== 'CAUTIOUS') {
      campaign.step();
      expect(campaign.truth.tick).toBeLessThan(DAWN);
    }
    const bn = campaign.truth.formations['red-bn'];
    const breakdown = computeDetectionTN(campaign.truth, bn, 'PASSIVE_SENSOR', true);
    expect(breakdown.base).toBe(5);
    expect(breakdown.mods).toEqual([
      { label: 'cautious movement', value: 2 },
      { label: 'EMCON dark', value: 2 },
      { label: 'woods', value: 1 },
      { label: 'night', value: 2 },
    ]);
    expect(breakdown.tn).toBe(12);
  });

  it('night crossing: every sensor-line roll is logged at TN 12 and none connect — ' +
     'Blue sees nothing', () => {
    const campaign = Campaign.create(buildScenario());
    runTo(campaign, DAWN);

    // the station did roll against the battalion — silently, at TN 12
    const stationRolls = campaign.store.all()
      .filter(l => l.event.type === 'DIE_ROLLED')
      .map(l => (l.event as any).roll)
      .filter((r: any) => r.purpose.includes('Sensor Station Echo') &&
                          r.purpose.includes('red-bn'));
    expect(stationRolls.length).toBeGreaterThanOrEqual(3);
    for (const r of stationRolls) {
      expect(r.purpose).toContain('TN 12');
      expect(r.result).toBeLessThan(12); // the seed's dice: no boxcars on the line tonight
    }

    // effectively invisible: no Blue contact on the battalion exists in truth,
    expect(blueContacts(campaign.truth)).toHaveLength(0);
    // and the Blue player's map shows nothing at all
    const view = project(campaign.truth, 'blue', campaign.truth.tick);
    expect(view.contacts).toHaveLength(0);
    expect(view.reports).toHaveLength(0);
    // the battalion reached its lay-up hex unseen
    expect(campaign.truth.formations['red-bn'].pos).toEqual(gp(12, 6));
  });

  it('daylight: the off-net scout finds the hide site, but Blue HQ still sees NOTHING', () => {
    const campaign = Campaign.create(buildScenario());
    runTo(campaign, DAWN);

    // run until the scout earns at least SHADOW (cap: well before the t90 RTB)
    while (!blueContacts(campaign.truth).some(c => c.level >= 2)) {
      campaign.step();
      expect(campaign.truth.tick).toBeLessThan(90);
    }

    const scout = campaign.truth.formations['blue-scout'];
    expect(scout.onNet).toBe(false); // 13 hexes from the HQ node: off-net

    const held = Object.values(campaign.truth.reports)
      .filter(r => r.sideId === 'blue' && r.sourceFormationId === 'blue-scout');
    expect(held.length).toBeGreaterThan(0);
    for (const r of held) expect(r.deliveredTick).toBeNull();

    // double-blind holds: truth knows, the player map does not
    const view = project(campaign.truth, 'blue', campaign.truth.tick);
    expect(view.contacts).toHaveLength(0);
    expect(view.reports).toHaveLength(0);
  });

  it('the report delivers ONLY when the scout returns on-net, stale timestamp preserved', () => {
    const campaign = Campaign.create(buildScenario());
    runTo(campaign, DAWN);
    while (!blueContacts(campaign.truth).some(c => c.level >= 2)) campaign.step();

    // run through the t90 RTB until delivery
    while (!Object.values(campaign.truth.reports)
        .some(r => r.sideId === 'blue' && r.deliveredTick !== null)) {
      campaign.step();
      expect(campaign.truth.tick).toBeLessThan(240);
    }

    const scout = campaign.truth.formations['blue-scout'];
    expect(scout.onNet).toBe(true); // delivery happened because the scout re-netted

    const delivered = Object.values(campaign.truth.reports)
      .filter(r => r.sideId === 'blue' && r.deliveredTick !== null);
    expect(delivered.length).toBeGreaterThan(0);
    for (const r of delivered) {
      expect(r.deliveredTick!).toBeGreaterThan(r.generatedTick); // courier lag is real
    }

    // NOW the Blue map shows the contact — with the staleness timestamp, not delivery time
    const view = project(campaign.truth, 'blue', campaign.truth.tick);
    expect(view.contacts.length).toBeGreaterThanOrEqual(1);
    const c = view.contacts[0];
    expect(c.level).toBeGreaterThanOrEqual(2);
    expect(c.staleAsOfTick).toBeLessThan(campaign.truth.tick);
    expect(c.ageTicks).toBe(campaign.truth.tick - c.staleAsOfTick);
    expect(view.reports.length).toBeGreaterThan(0);
  });

  it('counter-intel branch: kill the messenger and the report dies with him', () => {
    const campaign = Campaign.create(buildScenario());
    runTo(campaign, DAWN);
    while (!blueContacts(campaign.truth).some(c => c.level >= 2)) campaign.step();

    // red infantry finds the scout before he can ride home
    campaign.destroyFormation('blue-scout', 'ambushed on the return leg');
    runTo(campaign, 150);

    const blueReports = Object.values(campaign.truth.reports)
      .filter(r => r.sideId === 'blue' && r.sourceFormationId === 'blue-scout');
    expect(blueReports.length).toBeGreaterThan(0);
    for (const r of blueReports) {
      expect(r.deliveredTick).toBeNull();
      expect(r.lost).toBe(true);
    }
    const view = project(campaign.truth, 'blue', campaign.truth.tick);
    expect(view.contacts).toHaveLength(0);
    expect(view.reports).toHaveLength(0);
  });

  it('negative control: the same battalion, careless, is detected almost immediately', () => {
    const truth = baseTruth(SEED + '-CONTROL', [], 30, 22);
    truth.tick = 70; // daylight
    truth.facilities['blue-station'] = mkFacility({
      id: 'blue-station', sideId: 'blue', name: 'Sensor Station Echo',
      pos: gp(10, 8), tags: ['SENSOR_STATION'],
      sensorStation: { passive: 6, active: 12 },
    });
    const bn = addMechFormation(truth,
      { id: 'red-bn', sideId: 'red', pos: gp(16, 8), omp: 1, sigBase: 5 }, 12, {});
    truth.orders['b1'] = moveOrder('b1', bn, 'MOVE',
      Array.from({ length: 10 }, (_, i) => gp(15 - i, 8)), 70);

    const campaign = Campaign.create(truth);
    runTo(campaign, 70 + 50); // five pulses
    const contact = Object.values(campaign.truth.contacts)
      .find(c => c.observerSideId === 'blue' && c.targetFormationId === 'red-bn');
    expect(contact).toBeTruthy(); // moving PASSIVE in the open by day: TN 4
    // station is fixed infrastructure: report hit Blue's map in real time
    expect(project(campaign.truth, 'blue', campaign.truth.tick)
      .contacts.length).toBeGreaterThan(0);
  });

  it('the whole scenario is auditable: full replay reproduces truth, every roll re-derivable', () => {
    const campaign = Campaign.create(buildScenario());
    runTo(campaign, 150);

    expect(replay(campaign.store.all())).toEqual(campaign.truth);

    const rolls = campaign.store.all()
      .filter(l => l.event.type === 'DIE_ROLLED')
      .map(l => (l.event as any).roll);
    expect(rolls.length).toBeGreaterThan(10);
    for (const r of rolls) {
      expect(rollDice(SEED, r.seedCursor, r.dice).result).toBe(r.result);
    }
  });
});
