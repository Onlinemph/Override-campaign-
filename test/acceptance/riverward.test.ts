/**
 * Acceptance — OPERATION RIVERWARD (demo/riverward.json): the continent-generator
 * showcase. The campaign was BUILT by reading generated geography (D-041/D-044) —
 * the capital, the great river, the bridges the road net laid — and the opening
 * act is the bridge war itself: the assault marches on the capital, the recon
 * satellite tips off the defenders, the hidden demo team drops the span in the
 * column's face (D-045: demolition from the bank, by an off-net conditional —
 * D-046 trigger semantics), the pioneers bridge the gap, and the crossing ends
 * frozen in a battle at the held bridgehead. Byte-exact replay.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { loadCampaignFixture } from '../../src/demo.js';
import { validateCampaign } from '../../src/campaign/schema.js';
import { findRoute } from '../../src/engine/route.js';
import { stallReason } from '../../src/engine/stall.js';
import { isLibraryAvailable } from '../../src/roster/library.js';
import { hexKey } from '../../src/core/types.js';
import { readFileSync } from 'node:fs';
import type { GroundPos, TruthState } from '../../src/core/types.js';

const path = join(__dirname, '../../demo/riverward.json');
const has = isLibraryAvailable();

const T = 'cascara';
const CAPITAL = { q: 9, r: 9 }; // seed RIVERWARD-9 (printed by make-riverward.mjs)
const gp = (p: { q: number; r: number }): GroundPos =>
  ({ kind: 'ground', theaterId: T, q: p.q, r: p.r });
const hexAt = (t: TruthState, p: { q: number; r: number }) =>
  t.theaters[T].hexes[hexKey(p.q, p.r)];

/** The first great-river span on the assault's route to the capital. */
function contestedSpan(t: TruthState): GroundPos {
  const route = findRoute(t, t.formations['blue-assault'], gp(CAPITAL));
  expect(route).toBeTruthy();
  const span = route!.path.find(p => {
    const h = hexAt(t, p);
    return h?.terrain === 'WATER' && h.infra.includes('BRIDGE');
  });
  expect(span).toBeTruthy(); // the river divides: no bridge, no capital
  return gp(span!);
}

describe.skipIf(!has)('OPERATION RIVERWARD — the bridge war on a generated continent', () => {
  it('validates clean; the found geography and the toolkit are all real', () => {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    expect(validateCampaign(json)).toEqual([]);
    const t = loadCampaignFixture(path);

    // derivations: the bridgelayer is an engineer, the hover cavalry hovers,
    // the scout helicopters fly, the listening post has HQ ears
    const tagsOf = (name: string) =>
      Object.values(t.units).find(u => u.name === name)?.tags ?? [];
    expect(tagsOf('Pioneer 1')).toContain('ENGINEER');
    expect(tagsOf('Kelpie 1')).toContain('HOVER');
    expect(Object.values(t.units).find(u => u.name === 'Merlin 1')?.class).toBe('VTOL');
    expect(tagsOf('Argent Span Post')).toContain('HQ');

    // every demo team hides at its bridgehead, charges wired on a real span as a
    // STANDING RULE (D-049) — it survives any order and fires off-net
    for (const i of [0, 1, 2]) {
      expect(t.orders[`o-sap-${i}`].kind).toBe('HIDE'); // they can genuinely hide now
      const rule = t.formations[`red-sap-${i}`].rules![0];
      expect(rule.trigger.when).toBe('CONTACT_WITHIN');
      expect(rule.thenOrder.kind).toBe('DEMOLISH');
      const wired = hexAt(t, rule.thenOrder.targetHex as GroundPos);
      expect(wired.terrain).toBe('WATER');
      expect(wired.infra).toContain('BRIDGE');
    }
    // the battery's registered fires are a rule too — it needs no order at all
    expect(t.formations['red-arty'].rules![0].trigger.when).toBe('ALLY_ENGAGED');
    expect(t.formations['red-arty'].rules![0].thenOrder.kind).toBe('FIRE');

    // the route to the capital crosses the great river on a wired span
    const span = contestedSpan(t);
    const wiredSpans = [0, 1, 2].map(i =>
      t.formations[`red-sap-${i}`].rules![0].thenOrder.targetHex as GroundPos);
    expect(wiredSpans.some(w => w.q === span.q && w.r === span.r)).toBe(true);
  });

  it('the Verdigris command line (D-048): masts chain every bridgehead onto the net — and cutting one drops the line', () => {
    const c = Campaign.create(loadCampaignFixture(path));
    c.step(); // netPass runs
    // every bridge guard and demo team is commandable through the relay chain
    for (const i of [0, 1, 2]) {
      expect(c.truth.formations[`red-guard-${i}`].onNet).toBe(true);
      expect(c.truth.formations[`red-sap-${i}`].onNet).toBe(true);
    }
    const r = c.issueOrder({ id: 'o-test', sideId: 'marik', formationId: 'red-guard-0',
      kind: 'REST', issuedTick: c.truth.tick, effectiveTick: c.truth.tick + 1,
      conditionals: [], path: [] });
    expect(r.ok).toBe(true);

    // cut the line: drop the mast the Argent guard nets through, and the whole
    // bridgehead goes dark (orders bounce with the relay hint)
    const mastId = c.truth.formations['red-guard-0'].netNodeId!;
    expect(mastId).toMatch(/mast/);
    delete c.truth.facilities[mastId]; // demolished (test surgery — no facility-kill event yet)
    c.step();
    expect(c.truth.formations['red-guard-0'].onNet).toBe(false);
    const dark = c.issueOrder({ id: 'o-dark', sideId: 'marik', formationId: 'red-guard-0',
      kind: 'REST', issuedTick: c.truth.tick, effectiveTick: c.truth.tick + 1,
      conditionals: [], path: [] });
    expect(dark.ok).toBe(false);
    if (!dark.ok) expect(dark.reason).toMatch(/relay/);
  });

  it('plays the crossing: the span blows in their face, the pioneers answer, battle at the bridgehead', () => {
    const c = Campaign.create(loadCampaignFixture(path));
    const span = contestedSpan(c.truth);
    const spanInfra = () => hexAt(c.truth, span).infra;
    const posOf = (id: string) => c.truth.formations[id].pos as GroundPos;

    // Act I — the assault lance marches on the capital along the route the engine
    // itself plots (over the span). The recon satellite samples the road; the
    // guard's listening post picks the column up on the approach; the demo team's
    // conditional drops the span BEFORE the column reaches it.
    const route = findRoute(c.truth, c.truth.formations['blue-assault'], gp(CAPITAL))!;
    c.inject({ type: 'ORDER_ISSUED', order: { id: 'o-march', sideId: 'skye',
      formationId: 'blue-assault', issuedTick: 0, effectiveTick: 1, kind: 'MOVE',
      path: route.path.map(p => gp(p)), conditionals: [] } });

    let steps = 0;
    while (spanInfra().includes('BRIDGE')) {
      expect(c.truth.pendingEngagementId, 'collided before the sappers fired').toBeFalsy();
      c.step();
      if (++steps > 2500) throw new Error('the demo team never fired');
    }
    // still on the wrong bank, and the order explains why it is stuck
    const stallAt = posOf('blue-assault');
    expect(stallAt.q === span.q && stallAt.r === span.r).toBe(false);
    expect(stallReason(c.truth, c.truth.formations['blue-assault'])).toMatch(/impassable/);

    // Act II — the pioneers march to the assault's bank and span the gap from it
    // (D-045: BUILD_BRIDGE with an adjacent targetHex — open water they could
    // never drive into)
    const bank = { q: stallAt.q, r: stallAt.r };
    const engRoute = findRoute(c.truth, c.truth.formations['blue-eng'], gp(bank))!;
    let t0 = c.truth.tick;
    c.inject({ type: 'ORDER_ISSUED', order: { id: 'o-pioneers', sideId: 'skye',
      formationId: 'blue-eng', issuedTick: t0, effectiveTick: t0 + 1, kind: 'MOVE',
      path: engRoute.path.map(p => gp(p)), conditionals: [] } });
    steps = 0;
    while (posOf('blue-eng').q !== bank.q || posOf('blue-eng').r !== bank.r) {
      c.step();
      if (++steps > 2500) throw new Error('pioneers never reached the bank');
    }
    t0 = c.truth.tick;
    c.inject({ type: 'ORDER_ISSUED', order: { id: 'o-span', sideId: 'skye',
      formationId: 'blue-eng', issuedTick: t0, effectiveTick: t0 + 1,
      kind: 'BUILD_BRIDGE', targetHex: span, conditionals: [] } });
    steps = 0;
    while (!spanInfra().includes('BRIDGE')) {
      c.step();
      if (++steps > 600) throw new Error('the new span never went in');
    }

    // Act III — the standing MOVE resumes over the new span; the crossing ends
    // frozen in an engagement at the held bridgehead (that battle is for the table)
    steps = 0;
    while (!c.truth.pendingEngagementId) {
      c.step();
      if (++steps > 800) throw new Error('the assault never crossed');
    }
    const battle = c.truth.engagements[c.truth.pendingEngagementId!];
    // the fight is at the bridgehead: the hex the guard formation holds, one hex
    // across the water from where the column stalled
    const guardHexes = [0, 1, 2].map(i => posOf(`red-guard-${i}`));
    expect(guardHexes.some(g =>
      g.q === (battle.hex as GroundPos).q && g.r === (battle.hex as GroundPos).r)).toBe(true);

    // the whole crossing, byte-exact from the log
    expect(replay(c.store.all())).toEqual(c.truth);
  }, 120_000);
});
