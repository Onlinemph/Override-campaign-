/** M7 — engineers & minefields (core §9.3). */
import { describe, expect, it } from 'vitest';
import { engineeringPass } from '../../src/engine/engineering.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { CLOCK } from '../../src/rules.js';
import { addMechFormation, baseTruth, gp, T } from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

function run(truth: TruthState, dt = CLOCK.TICKS_PER_PULSE): GameEvent[] {
  const events: GameEvent[] = [];
  engineeringPass(truth, dt, e => { events.push(e); applyEvent(truth, e); });
  return events;
}
function order(truth: TruthState, fId: string, kind: Order['kind']): void {
  const o: Order = { id: `o-${fId}`, sideId: truth.formations[fId].sideId, formationId: fId,
    kind, issuedTick: 0, effectiveTick: 0, conditionals: [] };
  truth.orders[o.id] = o; truth.formations[fId].currentOrderId = o.id;
}
function engineer(truth: TruthState, id: string, pos: ReturnType<typeof gp>) {
  return addMechFormation(truth, { id, sideId: 'blue', pos }, 1, { tags: ['ENGINEER'], class: 'INFANTRY' });
}

describe('M7 — engineers', () => {
  it('LAY_MINES drops a hidden minefield in the hex after one pulse and registers it', () => {
    const truth = baseTruth('ENG-MINE');
    engineer(truth, 'eng', gp(5, 5));
    order(truth, 'eng', 'LAY_MINES');
    run(truth);
    const mine = Object.values(truth.markers).find(m => m.kind === 'MINEFIELD');
    expect(mine).toBeTruthy();
    expect(mine!.sideId).toBe('blue');
    expect(truth.theaters[T].hexes['5,5'].minefieldIds).toContain(mine!.id);
    expect(truth.orders['o-eng'].completed).toBe(true);
  });

  it('BREACH takes two pulses and clears the minefield', () => {
    const truth = baseTruth('ENG-BREACH');
    // a pre-existing enemy minefield
    applyEvent(truth, { type: 'MARKER_ADDED', marker: { id: 'm1', kind: 'MINEFIELD',
      pos: gp(5, 5), sideId: 'red', payload: {} } });
    engineer(truth, 'eng', gp(5, 5));
    order(truth, 'eng', 'BREACH');
    run(truth); // 1 pulse — not done
    expect(truth.markers['m1']).toBeTruthy();
    run(truth); // 2 pulses — cleared
    expect(truth.markers['m1']).toBeUndefined();
    expect(truth.theaters[T].hexes['5,5'].minefieldIds).toHaveLength(0);
  });

  it('DEMOLISH instantly blows a bridge and makes noise (SIG −3)', () => {
    const truth = baseTruth('ENG-DEMO', [{ q: 5, r: 5, infra: ['ROAD', 'BRIDGE'] }]);
    engineer(truth, 'eng', gp(5, 5));
    order(truth, 'eng', 'DEMOLISH');
    run(truth);
    expect(truth.theaters[T].hexes['5,5'].infra).toEqual(['ROAD']);
    expect(truth.formations['eng'].transient?.fired).toBe(true);
    expect(truth.orders['o-eng'].completed).toBe(true);
  });

  it('BUILD_BRIDGE takes four pulses', () => {
    const truth = baseTruth('ENG-BUILD', [{ q: 5, r: 5, terrain: 'WATER' }]);
    engineer(truth, 'eng', gp(5, 5));
    order(truth, 'eng', 'BUILD_BRIDGE');
    for (let i = 0; i < 3; i++) run(truth);
    expect(truth.theaters[T].hexes['5,5'].infra).not.toContain('BRIDGE');
    run(truth); // 4th pulse
    expect(truth.theaters[T].hexes['5,5'].infra).toContain('BRIDGE');
  });

  // D-045: sappers work from the bank — an adjacent targetHex names the work site
  it('DEMOLISH blows an ADJACENT span named by targetHex (work from the bank)', () => {
    const truth = baseTruth('ENG-DEMO-ADJ', [{ q: 6, r: 5, terrain: 'WATER', infra: ['ROAD', 'BRIDGE'] }]);
    engineer(truth, 'eng', gp(5, 5)); // on the bank, beside the span
    order(truth, 'eng', 'DEMOLISH');
    truth.orders['o-eng'].targetHex = gp(6, 5);
    run(truth);
    expect(truth.theaters[T].hexes['6,5'].infra).toEqual(['ROAD']);
    expect(truth.orders['o-eng'].completed).toBe(true);
  });

  it('BUILD_BRIDGE spans adjacent open water a ground engineer could never enter', () => {
    const truth = baseTruth('ENG-BUILD-ADJ', [{ q: 6, r: 5, terrain: 'WATER' }]);
    engineer(truth, 'eng', gp(5, 5));
    order(truth, 'eng', 'BUILD_BRIDGE');
    truth.orders['o-eng'].targetHex = gp(6, 5);
    for (let i = 0; i < 4; i++) run(truth);
    expect(truth.theaters[T].hexes['6,5'].infra).toContain('BRIDGE');
    expect(truth.orders['o-eng'].completed).toBe(true);
  });

  it('a work site farther than one hex stalls the order (no teleporting charges)', () => {
    const truth = baseTruth('ENG-FAR', [{ q: 9, r: 5, terrain: 'WATER', infra: ['BRIDGE'] }]);
    engineer(truth, 'eng', gp(5, 5));
    order(truth, 'eng', 'DEMOLISH');
    truth.orders['o-eng'].targetHex = gp(9, 5);
    run(truth);
    expect(truth.theaters[T].hexes['9,5'].infra).toContain('BRIDGE'); // untouched
    expect(truth.orders['o-eng'].completed).toBeFalsy();              // waiting, not dropped
  });

  it('a non-engineer cannot run the toolkit', () => {
    const truth = baseTruth('ENG-NOPE');
    addMechFormation(truth, { id: 'mech', sideId: 'blue', pos: gp(5, 5) });
    order(truth, 'mech', 'LAY_MINES');
    run(truth);
    expect(Object.values(truth.markers)).toHaveLength(0);
    expect(truth.orders['o-mech'].completed).toBe(true); // dropped
  });
});

describe('M7 — minefields bite', () => {
  it('an enemy entering a mined hex takes a hit; your own mines are safe', () => {
    const truth = baseTruth('MINE-BITE');
    applyEvent(truth, { type: 'MARKER_ADDED', marker: { id: 'm1', kind: 'MINEFIELD',
      pos: gp(5, 5), sideId: 'blue', payload: {} } });
    // a red mover that just entered the mined hex (soft ⇒ reliably bitten)
    const red = addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(5, 5) },
      1, { class: 'INFANTRY' });
    red.transient = { moved: 'NORMAL', onRoad: false, fired: false };
    let guard = 0, bitten = false;
    // the bite rolls 2d6 ≥7; re-seed-ish by stepping until it lands (deterministic per seed)
    const uid = truth.formations['red-1'].unitIds[0];
    while (!bitten && guard++ < 1) {
      run(truth, CLOCK.TICKS_PER_PULSE);
      bitten = truth.units[uid].damage !== 'OK';
    }
    // with seed MINE-BITE the first 2d6 ≥7 → infantry takes 2 steps
    const ev = truth; void ev;
    expect(['DAMAGED', 'CRIPPLED', 'DESTROYED']).toContain(truth.units[uid].damage);
  });

  it('a friendly formation is not bitten by its own minefield', () => {
    const truth = baseTruth('MINE-FRIEND');
    applyEvent(truth, { type: 'MARKER_ADDED', marker: { id: 'm1', kind: 'MINEFIELD',
      pos: gp(5, 5), sideId: 'blue', payload: {} } });
    const blue = addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(5, 5) });
    blue.transient = { moved: 'NORMAL', onRoad: false, fired: false };
    expect(run(truth).some(e => e.type === 'DIE_ROLLED')).toBe(false);
  });
});
