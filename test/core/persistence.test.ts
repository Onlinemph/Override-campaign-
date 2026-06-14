/** M6 — durable campaigns: resume from a JSONL log, byte-identical, across "restarts". */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Campaign } from '../../src/core/truth.js';
import { JsonlEventStore } from '../../src/core/log.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { TruthState } from '../../src/core/types.js';

const dir = mkdtempSync(join(tmpdir(), 'override-persist-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function scenario(): TruthState {
  const truth = baseTruth('PERSIST-SEED');
  const hq = addMechFormation(truth, { id: 'blue-hq', sideId: 'blue', pos: gp(2, 2) });
  truth.sides['blue'].commandNodes = [hq.id];
  addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(12, 2), sigBase: 6 });
  const mover = truth.formations['red-1'];
  truth.orders['o1'] = moveOrder('o1', mover, 'MOVE',
    [gp(11, 2), gp(10, 2), gp(9, 2), gp(8, 2), gp(7, 2)]);
  return truth;
}

describe('M6 — persistence', () => {
  it('resumeOrCreate: fresh store creates, non-empty store resumes', () => {
    const path = join(dir, 'a.jsonl');
    const first = Campaign.resumeOrCreate(new JsonlEventStore(path), scenario);
    expect(first.resumed).toBe(false);
    for (let i = 0; i < 8; i++) first.campaign.step();

    // "restart": a brand-new store object over the same file
    const second = Campaign.resumeOrCreate(new JsonlEventStore(path), () => {
      throw new Error('must not rebuild the fixture when resuming');
    });
    expect(second.resumed).toBe(true);
    expect(second.campaign.truth).toEqual(first.campaign.truth);
    expect(second.campaign.store.length()).toBe(first.campaign.store.length());
  });

  it('a campaign survives a mid-run restart and keeps advancing identically', () => {
    const live = join(dir, 'live.jsonl');
    const control = join(dir, 'control.jsonl');
    // both campaigns must share one genesis (mkUnit ids come from a global counter,
    // so a fresh scenario() each time would be a genuinely different fixture)
    const genesis = scenario();
    const fresh = () => structuredClone(genesis);

    // control: one continuous campaign
    const ctl = Campaign.resumeOrCreate(new JsonlEventStore(control), fresh).campaign;
    for (let i = 0; i < 16; i++) ctl.step();

    // live: run 8, "crash", resume from disk, run 8 more
    const a = Campaign.resumeOrCreate(new JsonlEventStore(live), fresh).campaign;
    for (let i = 0; i < 8; i++) a.step();
    const b = Campaign.resumeOrCreate(new JsonlEventStore(live), fresh).campaign;
    for (let i = 0; i < 8; i++) b.step();

    expect(b.truth).toEqual(ctl.truth);
    expect(b.store.length()).toBe(ctl.store.length());
  });

  it('order entry persists across a restart', () => {
    const path = join(dir, 'orders.jsonl');
    const a = Campaign.resumeOrCreate(new JsonlEventStore(path), scenario).campaign;
    a.step(); // nets settle so the HQ-adjacent formation is on-net
    const f = a.truth.formations['blue-hq'];
    expect(f.onNet).toBe(true);
    const res = a.issueOrder({ id: 'manual', sideId: 'blue', formationId: 'blue-hq',
      kind: 'MOVE', path: [gp(3, 2)], conditionals: [], issuedTick: 0, effectiveTick: 0 });
    expect(res.ok).toBe(true);

    const b = Campaign.resumeOrCreate(new JsonlEventStore(path), scenario).campaign;
    expect(b.truth.orders['manual']).toBeTruthy();
    expect(b.truth.orders['manual'].path).toEqual([gp(3, 2)]);
  });
});
