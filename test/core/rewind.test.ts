/** GM time-travel — undo/rewind (D-015): drop a suffix of the log, replay the prefix. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Campaign } from '../../src/core/truth.js';
import { JsonlEventStore } from '../../src/core/log.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { TruthState } from '../../src/core/types.js';

const dir = mkdtempSync(join(tmpdir(), 'override-rewind-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function scenario(): TruthState {
  const truth = baseTruth('REWIND-SEED');
  const hq = addMechFormation(truth, { id: 'blue-hq', sideId: 'blue', pos: gp(2, 2) });
  truth.sides['blue'].commandNodes = [hq.id];
  addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(12, 2), sigBase: 6 });
  const mover = truth.formations['red-1'];
  truth.orders['o1'] = moveOrder('o1', mover, 'MOVE', [gp(11, 2), gp(10, 2), gp(9, 2), gp(8, 2)]);
  return truth;
}

describe('GM time-travel — rewind/undo (D-015)', () => {
  it('rewindOneStep returns to the prior tick, byte-exact', () => {
    const c = Campaign.create(scenario());
    for (let i = 0; i < 5; i++) c.step();
    const snapshot = structuredClone(c.truth);
    const lenAt5 = c.store.length();

    c.step(); c.step();
    expect(c.truth.tick).toBeGreaterThan(snapshot.tick); // a step advances by the clock-mode dt

    expect(c.rewindOneStep()).not.toBeNull(); // undo step 7
    const back = c.rewindOneStep();            // undo step 6
    expect(back).toEqual({ tick: snapshot.tick });
    expect(c.truth).toEqual(snapshot);
    expect(c.store.length()).toBe(lenAt5);
  });

  it('rewind then re-step reproduces the same forward state (determinism preserved)', () => {
    const c = Campaign.create(scenario());
    for (let i = 0; i < 8; i++) c.step();
    const forward = structuredClone(c.truth);

    c.rewindOneStep(); c.rewindOneStep(); c.rewindOneStep();
    expect(c.truth.tick).toBeLessThan(forward.tick); // walked back three steps
    c.step(); c.step(); c.step();

    expect(c.truth).toEqual(forward);
  });

  it('refuses to rewind past the opening setup', () => {
    const c = Campaign.create(scenario());
    expect(c.rewindOneStep()).toBeNull(); // nothing stepped yet
    c.step();
    expect(c.rewindOneStep()).not.toBeNull();
    expect(c.rewindOneStep()).toBeNull(); // back at the start again
  });

  it('rewindToTick rolls back to the last state at or before the target (D-035)', () => {
    const c = Campaign.create(scenario());
    for (let i = 0; i < 6; i++) c.step('CONTACT'); // 6 single ticks
    const midTick = c.truth.tick;
    const midEvents = c.store.length();
    const midState = JSON.stringify(c.truth);
    for (let i = 0; i < 6; i++) c.step('CONTACT'); // on to tick 12
    c.destroyFormation('red-1', 'test loss');
    expect(c.truth.tick).toBe(12);

    const r = c.rewindToTick(midTick);
    expect(r).not.toBeNull();
    expect(r!.tick).toBe(midTick);
    expect(c.store.length()).toBe(midEvents);
    // byte-exact: the rewound truth IS the state we had at that moment
    expect(JSON.stringify(c.truth)).toBe(midState);
    // the loss entered after the cut is undone
    expect(c.truth.formations['red-1'].destroyed).toBeFalsy();
    // and the campaign keeps running from there
    c.step('CONTACT');
    expect(c.truth.tick).toBe(midTick + 1);
  });

  it('rewindToTick lands mid-step targets on the boundary below; refuses futures', () => {
    const c = Campaign.create(scenario());
    const ticks: number[] = [];
    for (let i = 0; i < 3; i++) { c.step(); ticks.push(c.truth.tick); }
    const r = c.rewindToTick(ticks[1] - 1);        // inside the second step
    expect(r!.tick).toBe(ticks[0]);                // whole steps only — no half-applied state
    expect(c.rewindToTick(ticks[0])).toBeNull();   // at the clock: nothing after it
    expect(c.rewindToTick(99999)).toBeNull();      // the future: nothing to undo
  });

  it('previewRewind is a receipt, not a cut — and the receipt matches the cut', () => {
    const c = Campaign.create(scenario());
    for (let i = 0; i < 4; i++) c.step('CONTACT');
    c.destroyFormation('red-1', 'test loss');
    const before = c.store.length();
    const beforeState = JSON.stringify(c.truth);

    const p = c.previewRewind(2)!;
    expect(p.toTick).toBe(2);
    expect(p.dropped).toBeGreaterThan(0);
    expect(p.notable.join(' ')).toContain('the loss of red-1');
    expect(c.store.length()).toBe(before);                 // nothing moved
    expect(JSON.stringify(c.truth)).toBe(beforeState);
    expect(c.rewindToTick(2)!.dropped).toBe(p.dropped);    // receipt == reality
  });

  it('JSONL store: the rewind is persisted across a restart', () => {
    const path = join(dir, 'rw.jsonl');
    const genesis = scenario();
    const a = Campaign.resumeOrCreate(new JsonlEventStore(path), () => structuredClone(genesis)).campaign;
    for (let i = 0; i < 8; i++) a.step();
    a.rewindOneStep(); a.rewindOneStep(); a.rewindOneStep();
    const tickAfter = a.truth.tick;
    const lenAfter = a.store.length();

    // "restart" from disk: the resumed campaign must reflect the rewound log
    const b = Campaign.resumeOrCreate(new JsonlEventStore(path),
      () => { throw new Error('must resume, not rebuild'); }).campaign;
    expect(b.truth.tick).toBe(tickAfter);
    expect(b.truth).toEqual(a.truth);
    expect(b.store.length()).toBe(lenAfter);
  });
});
