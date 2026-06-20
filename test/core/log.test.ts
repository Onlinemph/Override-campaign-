/** B2 — append-only event log; truth = fold(events); full replay determinism. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { JsonlEventStore, MemoryEventStore } from '../../src/core/log.js';
import { Campaign, replay } from '../../src/core/truth.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';

function scenario() {
  const truth = baseTruth('LOG-TEST-SEED');
  const hq = addMechFormation(truth, { id: 'blue-hq', sideId: 'blue', pos: gp(2, 2) });
  truth.sides['blue'].commandNodes = [hq.id];
  addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(10, 2), sigBase: 6 });
  const mover = truth.formations['red-1'];
  truth.orders['o1'] = moveOrder('o1', mover, 'MOVE',
    [gp(9, 2), gp(8, 2), gp(7, 2), gp(6, 2), gp(5, 2)]);
  return truth;
}

const dir = mkdtempSync(join(tmpdir(), 'override-log-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('B2 — event log & replay', () => {
  it('append-only on the play path; truncate is the only history mutation (D-015 rewind)', () => {
    const store = new MemoryEventStore();
    // no in-place update/delete of individual events; the sole history-shortening method
    // is `truncate`, used exclusively by GM undo/rewind (Campaign.rewind).
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(store)).sort())
      .toEqual(['all', 'append', 'constructor', 'length', 'truncate']);
  });

  it('truth = fold(applyEvent, genesis, events): replay reproduces live state exactly', () => {
    const campaign = Campaign.create(scenario());
    for (let i = 0; i < 12; i++) campaign.step();
    const replayed = replay(campaign.store.all());
    expect(replayed).toEqual(campaign.truth);
  });

  it('every die roll in the log carries its seedCursor and is independently re-derivable', async () => {
    const campaign = Campaign.create(scenario());
    for (let i = 0; i < 12; i++) campaign.step();
    const { rollDice } = await import('../../src/core/rng.js');
    const rolls = campaign.store.all()
      .filter(l => l.event.type === 'DIE_ROLLED')
      .map(l => (l.event as any).roll);
    expect(rolls.length).toBeGreaterThan(0);
    for (const roll of rolls) {
      expect(rollDice('LOG-TEST-SEED', roll.seedCursor, roll.dice).result).toBe(roll.result);
      expect(roll.purpose).toBeTruthy();
    }
    // cursors strictly increase
    for (let i = 1; i < rolls.length; i++) {
      expect(rolls[i].seedCursor).toBeGreaterThan(rolls[i - 1].seedCursor);
    }
  });

  it('JSONL round-trip: persist, reload from disk, identical truth', () => {
    const path = join(dir, 'campaign.log.jsonl');
    const campaign = Campaign.create(scenario(), new JsonlEventStore(path));
    for (let i = 0; i < 8; i++) campaign.step();

    const reloaded = Campaign.fromStore(new JsonlEventStore(path));
    expect(reloaded.truth).toEqual(campaign.truth);
    expect(reloaded.store.length()).toBe(campaign.store.length());

    // continue from disk: both lines advance identically (determinism across restart)
    campaign.step();
    reloaded.step();
    expect(reloaded.truth).toEqual(campaign.truth);
  });

  it('a log not starting with CAMPAIGN_INIT is rejected', () => {
    expect(() => replay([])).toThrow();
  });
});
