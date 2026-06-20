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
