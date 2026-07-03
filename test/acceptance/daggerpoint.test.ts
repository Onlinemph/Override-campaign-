/**
 * Acceptance — OPERATION DAGGERPOINT (demo/assault.json): the showcase campaign
 * loads clean, every derivation fires, and the invasion's opening act plays on
 * plotted orders alone: burn in from the zenith (watched by light-lagged sensors),
 * descend, land at the LZ, and put the first lance on the dirt. Byte-exact replay.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { loadCampaignFixture } from '../../src/demo.js';
import { validateCampaign } from '../../src/campaign/schema.js';
import { project } from '../../src/projection/project.js';
import { isLibraryAvailable } from '../../src/roster/library.js';
import { readFileSync } from 'node:fs';

const path = join(__dirname, '../../demo/assault.json');
const has = isLibraryAvailable();

describe.skipIf(!has)('OPERATION DAGGERPOINT — the whole engine in one campaign', () => {
  it('validates clean and derives every signature tag from the record sheets', () => {
    expect(validateCampaign(JSON.parse(readFileSync(path, 'utf8')))).toEqual([]);
    const t = loadCampaignFixture(path);
    const tagsOf = (name: string) =>
      Object.values(t.units).find(u => u.name === name)?.tags ?? [];
    expect(tagsOf('Fortune’s Hammer')).toContain('SPHEROID');   // the flying egg
    expect(tagsOf('Swift Wing')).toContain('AERODYNE');         // the lifting body
    expect(tagsOf('Whisper')).toEqual(expect.arrayContaining(['ECM', 'BEAGLE'])); // Raven 3L
    expect(tagsOf('Silent One')).toContain('STEALTH');          // Sha Yu
    expect(tagsOf('Kerr')).toContain('C3M');                    // Atlas AS7-CM
    expect(tagsOf('Flak 1')).toContain('AA');                   // authored, merged
    expect(tagsOf('Net Actual')).toContain('HQ');               // Browning Mobile HQ
    expect(tagsOf('Pioneer 1')).toContain('ENGINEER');
    // fog of war extends to the sky chart: davion has not surveyed the pirate point
    expect(t.system.nodes['shadow-point'].secret).toBe(true);
    const view = project(t, 'davion', 0);
    expect(JSON.stringify(view.system ?? {})).not.toContain('shadow-point');
    // both fleets carry their armies: every mounted formation names a live carrier
    const mounted = Object.values(t.formations).filter(f => f.mounted);
    expect(mounted.length).toBeGreaterThanOrEqual(10);
    for (const f of mounted) expect(t.formations[f.mounted!.carrierFormationId]).toBeDefined();
  });

  it('plays the landing: burn in watched by light-lag, descend, land, first boots down', () => {
    const c = Campaign.create(loadCampaignFixture(path));
    const flagPos = () => c.truth.formations['blue-flag'].pos as import('../../src/core/types.js').Position;

    // Act I — the burn. 8 AU at 1G with the garrison watching: the drive plume arrives
    // light-lagged, and the defenders get their first contact long before the ship.
    let steps = 0;
    while (flagPos().kind !== 'node' ||
           (flagPos() as { nodeId?: string }).nodeId !== 'menghao') {
      c.step();
      if (++steps > 300) throw new Error('fleet never made orbit');
    }
    expect(c.truth.contacts['contact:liao:blue-flag']).toBeDefined(); // they saw us coming
    expect(c.truth.formations['blue-assault'].pos).toEqual(
      c.truth.formations['blue-flag'].pos); // the lance rode the whole way in

    // Act II — down the well, the spheroid way (D-037): DESCEND with a targetHex
    // arrives in the sky DIRECTLY OVER the cold LZ — cross in space, come down on the
    // spot; no crawling across a continent at 1 hex/turn.
    const t0 = c.truth.tick;
    c.inject({ type: 'ORDER_ISSUED', order: { id: 'o-descend', sideId: 'davion',
      formationId: 'blue-flag', issuedTick: t0, effectiveTick: t0 + 1,
      kind: 'DESCEND', targetHex: { kind: 'ground', theaterId: 'menghao', q: 68, r: 30 },
      conditionals: [] } });
    steps = 0;
    while (flagPos().kind !== 'air') {
      c.step();
      if (++steps > 60) throw new Error('never hit atmosphere');
    }

    const t1 = c.truth.tick;
    c.inject({ type: 'ORDER_ISSUED', order: { id: 'o-land', sideId: 'davion',
      formationId: 'blue-flag', issuedTick: t1, effectiveTick: t1 + 1,
      kind: 'LAND', targetHex: { kind: 'ground', theaterId: 'menghao', q: 68, r: 30 },
      conditionals: [] } });
    steps = 0;
    while (flagPos().kind !== 'ground') {
      c.step();
      if (++steps > 60) throw new Error('never landed');
    }
    expect(flagPos()).toEqual({ kind: 'ground', theaterId: 'menghao', q: 68, r: 30 });

    const t2 = c.truth.tick;
    c.inject({ type: 'ORDER_ISSUED', order: { id: 'o-debark', sideId: 'davion',
      formationId: 'blue-assault', issuedTick: t2, effectiveTick: t2 + 1,
      kind: 'DISEMBARK', targetHex: { kind: 'ground', theaterId: 'menghao', q: 69, r: 30 },
      conditionals: [] } });
    steps = 0;
    while (c.truth.formations['blue-assault'].mounted) {
      c.step();
      if (++steps > 20) throw new Error('lance never left the bay');
    }
    expect(c.truth.formations['blue-assault'].pos).toEqual(
      { kind: 'ground', theaterId: 'menghao', q: 69, r: 30 });

    // the whole invasion so far, byte-exact from the log
    expect(replay(c.store.all())).toEqual(c.truth);
  }, 60_000);
});
