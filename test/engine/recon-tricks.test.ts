/** The flavor pass (ext): SHADOW trails, C3M initiative, DECOY deception, air salvage. */
import { describe, expect, it } from 'vitest';
import { movementPass } from '../../src/engine/movement.js';
import { registerDetection } from '../../src/engine/detection.js';
import { buildHandoff } from '../../src/handoff/export.js';
import { ingestBattleResult } from '../../src/handoff/import.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { RECON_TRICKS, SIZE_CLASS_NAMES } from '../../src/rules.js';
import { hexDistance } from '../../src/hex/axial.js';
import { addFlight, addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { Engagement, GroundPos, TruthState } from '../../src/core/types.js';

function run(truth: TruthState, fn: (emit: (e: GameEvent) => void) => void): GameEvent[] {
  const events: GameEvent[] = [];
  fn(e => { events.push(e); applyEvent(truth, e); });
  return events;
}

describe('SHADOW — trail the contact, never close', () => {
  function shadowSetup() {
    const truth = baseTruth('SHADOW-1');
    addMechFormation(truth, { id: 'prey', sideId: 'red', pos: gp(15, 10) });
    const tail = addMechFormation(truth, { id: 'tail', sideId: 'blue', pos: gp(5, 10), omp: 20 });
    truth.contacts['contact:blue:prey'] = {
      id: 'contact:blue:prey', observerSideId: 'blue', targetFormationId: 'prey',
      kind: 'STANDARD', level: 2, lastConfirmedTick: 0, lastFadeTick: 0,
      estPos: gp(15, 10), posErrorHexes: 0, staleAsOfTick: 0,
      delivered: { level: 2, estPos: gp(15, 10), posErrorHexes: 0, asOfTick: 0 },
    };
    const order = { ...moveOrder('o1', tail, 'MOVE', []), kind: 'SHADOW' as const,
                    targetContactId: 'contact:blue:prey', path: [] };
    truth.orders['o1'] = order;
    tail.currentOrderId = 'o1';
    return truth;
  }

  it('closes to standoff range and holds — a standing order that never completes', () => {
    const truth = shadowSetup();
    for (let i = 0; i < 6; i++) run(truth, emit => movementPass(truth, 10, emit));
    const d = hexDistance(truth.formations['tail'].pos as GroundPos, gp(15, 10));
    expect(d).toBe(RECON_TRICKS.SHADOW_STANDOFF_HEXES); // at the ring, not inside it
    expect(truth.orders['o1'].completed).toBeUndefined();

    // more steps: still holding, never entering
    run(truth, emit => movementPass(truth, 10, emit));
    expect(hexDistance(truth.formations['tail'].pos as GroundPos, gp(15, 10)))
      .toBe(RECON_TRICKS.SHADOW_STANDOFF_HEXES);
  });
});

describe('C3M — the network is worth initiative', () => {
  it('a live C3 master adds +1 initiative to its side in the handoff', () => {
    const truth = baseTruth('C3-SEED');
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(5, 5) });
    addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(5, 5) },
      4, { tags: ['C3M'] });
    const eng: Engagement = {
      id: 'eng:test', tick: 0, hex: gp(5, 5), trigger: 'SAME_HEX',
      attackerSideId: 'red', defenderSideId: 'blue',
      attackerFormationIds: ['red-1'], defenderFormationIds: ['blue-1'], status: 'PENDING',
    };
    const pkg = buildHandoff(truth, eng);
    const blue = pkg.perSide.find(p => p.sideId === 'blue')!;
    const red = pkg.perSide.find(p => p.sideId === 'red')!;
    expect(blue.initiativeBonus).toBe(RECON_TRICKS.C3_INITIATIVE_BONUS);
    expect(red.initiativeBonus).toBe(0);
  });
});

describe('DECOY — the formation reads one size bigger', () => {
  it('enemy SHADOW-level intel reports the inflated size class', () => {
    const truth = baseTruth('DECOY-1');
    // a lance (sigBase 7) with a decoy reads as a company (sigBase 6)
    const liars = addMechFormation(truth, { id: 'liars', sideId: 'blue', pos: gp(5, 5),
      sigBase: 7 }, 4, { tags: ['DECOY'] });
    const honest = addMechFormation(truth, { id: 'honest', sideId: 'blue', pos: gp(9, 9),
      sigBase: 7 });
    const src = { id: 'watcher', name: 'Watcher', alwaysOnNet: true };
    run(truth, emit => {
      registerDetection(truth, emit, 'red', liars, 2, src, { setLevel: true });
      registerDetection(truth, emit, 'red', honest, 2, src, { setLevel: true });
    });
    expect(truth.contacts['contact:red:liars'].estSizeClass).toBe(SIZE_CLASS_NAMES[6]);
    expect(truth.contacts['contact:red:honest'].estSizeClass).toBe(SIZE_CLASS_NAMES[7]);
  });
});

describe('air kills rain down', () => {
  it('an air merge with a victor drops salvage tokens on the map below', () => {
    const truth = baseTruth('AIRSALV-1');
    const win = addFlight(truth, { id: 'win', sideId: 'blue', airPos: { q: 3, r: 4 }, fp: 200 });
    const lose = addFlight(truth, { id: 'lose', sideId: 'red', airPos: { q: 3, r: 4 }, fp: 200 });
    const eng: Engagement = {
      id: 'eng:air', tick: 0, trigger: 'AIR_INTERCEPT', domain: 'AIR',
      airPos: { kind: 'air', gridQ: 3, gridR: 4, band: 'HIGH', altLevel: 6,
                velocity: 2, vectorDeg: 0 },
      attackerSideId: 'blue', defenderSideId: 'red',
      attackerFormationIds: ['win'], defenderFormationIds: ['lose'], status: 'PENDING',
    };
    truth.engagements[eng.id] = eng;
    const events = ingestBattleResult(truth, eng, {
      handoffId: 'h1', victorSideId: 'blue',
      unitOutcomes: [{ unitId: lose.unitIds[0], damage: 'DESTROYED', ammoState: 'DRY',
                       pilotOutcomes: [] }],
      ejections: [], turnsElapsed: 4, notes: '',
    });
    for (const e of events) applyEvent(truth, e);
    const tokens = Object.values(truth.salvage);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].heldBy).toBe('blue');            // the sky-holder claims the wreck
    expect(tokens[0].hex).toEqual(gp(3, 4));          // it fell under the merge
  });
});
