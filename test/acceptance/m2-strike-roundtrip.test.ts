/**
 * M2 acceptance — orders, conditionals, engagement, handoff round-trip.
 *
 * The spec defines no fixed M2 acceptance scenario, so this is the milestone gate: a
 * scripted two-side encounter that exercises every M2 subsystem end to end and proves
 * the whole thing stays auditable (full-log replay byte-equality across the battle).
 *
 * Story: a Kurita raider lance (red) advances on a Davion outpost. A Davion line company
 * (blue) holds a conditional standing order — "if an enemy comes within 4 hexes, STRIKE
 * it." The trigger fires, blue closes and forces a battle, the GM resolves a failed
 * evasion then the tabletop fight, ingests the result, and the routed raider is pursued.
 */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { rollDice } from '../../src/core/rng.js';
import { addMechFormation, baseTruth, gp, moveOrder, T } from '../helpers.js';
import type { BattleResult, Order, TruthState } from '../../src/core/types.js';

const SEED = 'M2-ACCEPTANCE';

function scenario(): TruthState {
  const truth = baseTruth(SEED, [
    { q: 10, r: 10, infra: ['DEPOT', 'SPACEPORT'], objective: { vpPerDay: 3, hidden: false } },
  ], 30, 20);

  // Blue: line company dug in near the outpost, with a conditional STRIKE order.
  const blue = addMechFormation(truth,
    { id: 'blue-line', sideId: 'blue', pos: gp(12, 10), omp: 4, sigBase: 6 });
  truth.sides['blue'].commandNodes = ['blue-line'];
  truth.facilities['blue-depot'] = {
    id: 'blue-depot', sideId: 'blue', name: 'Outpost Depot', pos: gp(10, 10),
    tags: ['DEPOT', 'SPACEPORT'], fuelFarmTons: 0, supplyPoints: 50,
    turnaroundCrews: { total: 1, busyUntil: [] }, isCommandNode: true,
  };
  // standing order: PATROL, but if any contact comes within 4 hexes, STRIKE it.
  const strikeWhenClose: Order = {
    ...moveOrder('blue-patrol', blue, 'PATROL', []),
    conditionals: [{
      trigger: { when: 'CONTACT_WITHIN', param: 4 },
      thenOrder: { id: 'ph', sideId: 'blue', formationId: 'blue-line',
                   issuedTick: 0, effectiveTick: 0, kind: 'STRIKE',
                   targetContactId: 'contact:blue:red-raider' } as Order,
    }],
  };
  truth.orders['blue-patrol'] = strikeWhenClose;
  blue.currentOrderId = 'blue-patrol';
  blue.emcon = 'ACTIVE'; // outpost watch is lit up: it will detect the raider

  // Red: raider lance advancing on the outpost from the east.
  const red = addMechFormation(truth,
    { id: 'red-raider', sideId: 'red', pos: gp(18, 10), omp: 4, sigBase: 7 });
  truth.sides['red'].commandNodes = ['red-raider'];
  truth.orders['red-advance'] = moveOrder('red-advance', red, 'MOVE',
    Array.from({ length: 8 }, (_, i) => gp(17 - i, 10)), 0);
  return truth;
}

function runUntilPending(c: Campaign, cap = 60): void {
  let guard = 0;
  while (!c.pendingEngagement && guard++ < cap) {
    const before = c.truth.tick;
    c.step();
    if (c.truth.tick === before && !c.pendingEngagement) break; // stalled
  }
}

describe('M2 acceptance — strike round-trip', () => {
  it('a conditional STRIKE fires when the enemy closes, and forces an engagement', () => {
    const c = Campaign.create(scenario());
    runUntilPending(c);

    // the conditional fired and spawned a STRIKE order
    const fired = c.store.all().some(l => l.event.type === 'TRIGGER_FIRED');
    expect(fired).toBe(true);

    const eng = c.pendingEngagement;
    expect(eng).toBeTruthy();
    expect(eng!.attackerSideId).toBe('blue');         // blue pressed the strike
    expect(eng!.attackerFormationIds).toContain('blue-line');
    expect(eng!.defenderFormationIds).toContain('red-raider');
    // campaign is frozen
    expect(c.step()).toHaveLength(0);
  });

  it('evasion is consistent: success clears the engagement, failure keeps it pending', () => {
    // force a decisive defender by giving the raider huge OMP (it wins the opposed roll)
    const c = Campaign.create(scenario());
    runUntilPending(c);
    c.truth.formations['red-raider'].omp = 30;      // defender of nothing here; attacker is blue
    c.truth.formations['blue-line'].omp = 30;       // blue is attacker; boost defender (red)
    // red is the defender? No — blue struck, so red defends. Boost red's OMP for evasion.
    const eng = c.pendingEngagement!;
    expect(eng.defenderSideId).toBe('red');
    c.truth.formations['red-raider'].omp = 40;
    const ev = c.resolveEvasion();
    if (ev.success) {
      expect(c.truth.pendingEngagementId).toBeNull();
      expect(c.truth.engagements[eng.id].status).toBe('EVADED');
      // defender slipped and is auto-detected at CONTACT (core §7.1)
      expect(c.truth.contacts['contact:blue:red-raider'].level).toBeGreaterThanOrEqual(3);
    } else {
      expect(c.truth.pendingEngagementId).toBe(eng.id);
    }
  });

  it('handoff export → battle result ingest → rout & pursuit', () => {
    const c = Campaign.create(scenario());
    runUntilPending(c);
    const eng = c.pendingEngagement!;

    const pkg = c.exportHandoff()!;
    expect(pkg.table).toBe('GROUND');
    expect(c.pendingEngagement!.status).toBe('EXPORTED');

    const redUnits = c.truth.formations['red-raider'].unitIds;
    const blueUnits = c.truth.formations['blue-line'].unitIds;
    const result: BattleResult = {
      handoffId: pkg.id, victorSideId: 'blue', hexControlSideId: 'blue',
      unitOutcomes: [
        // raider crippled but not wiped — it will rout and run
        ...redUnits.map((uid, i) => ({ unitId: uid,
          damage: (i === 0 ? 'DESTROYED' : 'CRIPPLED') as 'DESTROYED' | 'CRIPPLED',
          ammoState: 'DRY', pilotOutcomes: [] })),
        ...blueUnits.map(uid => ({ unitId: uid, damage: 'DAMAGED' as const,
          ammoState: 'PARTIAL', pilotOutcomes: [] })),
      ],
      ejections: [{ pilotId: 'red-crew', pos: gp(13, 10) }],
      withdrewVia: { 'red-raider': 'NE' }, turnsElapsed: 11, notes: 'raider broken',
    };
    c.truth.formations['red-raider'].rdy = 2; // ensure rout threshold after −2 loss

    expect(c.ingestBattleResult(result).ok).toBe(true);
    expect(c.truth.pendingEngagementId).toBeNull();

    // outcomes landed
    expect(c.truth.units[redUnits[0]].damage).toBe('DESTROYED');
    expect(c.truth.formations['red-raider'].rdy).toBe(0);
    expect(c.truth.formations['red-raider'].routUntilTick).toBeGreaterThan(c.truth.tick);
    // both sides hold LOCK on each other (survived the battle, core §6.4)
    expect(c.truth.contacts['contact:blue:red-raider']?.level).toBe(4);
    expect(c.truth.contacts['contact:red:blue-line']?.level).toBe(4);
    // salvage to the victor; downed crew marker dropped
    expect(Object.values(c.truth.salvage).some(s => s.heldBy === 'blue')).toBe(true);
    expect(Object.values(c.truth.markers).some(m => m.kind === 'DOWNED_CREW')).toBe(true);
    // the raider withdrew east of the battle hex (pursuit seeded, core §7.4)
    expect((c.truth.formations['red-raider'].pos as { q: number }).q).toBe(eng.hex!.q + 1);

    // the campaign resumes after the battle
    c.step();
    expect(c.truth.tick).toBeGreaterThan(eng.tick);
  });

  it('the entire campaign — orders, trigger, battle, pursuit — replays byte-for-byte', () => {
    const c = Campaign.create(scenario());
    runUntilPending(c);
    expect(c.pendingEngagement).toBeTruthy();
    const ev = c.resolveEvasion(); // exercise the evasion roll path in the log
    if (!ev.success) {
      const pkg = c.exportHandoff()!;
      c.ingestBattleResult({
        handoffId: pkg.id, victorSideId: 'blue', hexControlSideId: 'blue',
        unitOutcomes: c.truth.formations['red-raider'].unitIds.map(uid => ({
          unitId: uid, damage: 'CRIPPLED' as const, ammoState: 'DRY', pilotOutcomes: [] })),
        ejections: [], withdrewVia: { 'red-raider': 'NE' }, turnsElapsed: 9, notes: '',
      });
    }
    for (let i = 0; i < 10; i++) c.step();
    expect(replay(c.store.all())).toEqual(c.truth);

    // every die roll (detection + evasion + salvage) remains independently re-derivable
    for (const l of c.store.all()) {
      if (l.event.type === 'DIE_ROLLED') {
        expect(rollDice(SEED, l.event.roll.seedCursor, l.event.roll.dice).result)
          .toBe(l.event.roll.result);
      }
    }
  });
});
