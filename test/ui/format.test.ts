/**
 * ui/format.js — the shared presentation module used by every screen. It's a browser
 * global (window.Fmt), so we load it by stubbing `window` and evaluating the file, then
 * assert the human-readable output that the GM/audit/player screens depend on.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let Fmt: any;
beforeAll(() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../../src/ui/format.js'), 'utf8');
  const win: any = {};
  (globalThis as any).window = win;
  (0, eval)(src); // the IIFE reads global `window`, then sets window.Fmt
  Fmt = win.Fmt;
});

describe('Fmt.clock / ago', () => {
  it('renders ticks as day + clock time (6 min/tick, dawn = 06:00)', () => {
    expect(Fmt.clock(0)).toBe('D1 00:00');
    expect(Fmt.clock(60)).toBe('D1 06:00');
    expect(Fmt.clock(240)).toBe('D2 00:00');
    expect(Fmt.clock(245)).toBe('D2 00:30');
    expect(Fmt.clock(null)).toBe('');
  });
  it('renders elapsed ticks as minutes/hours', () => {
    expect(Fmt.ago(1)).toBe('6 min');
    expect(Fmt.ago(9)).toBe('54 min');
    expect(Fmt.ago(10)).toBe('1h');
    expect(Fmt.ago(15)).toBe('1h 30m');
  });
});

describe('Fmt.humanize', () => {
  const truth = { formations: { f1: { name: 'Vixen' }, f2: { name: 'Probe' } }, facilities: {} };

  it('makes a STEP_BEGAN header and drops pure-noise/internal events', () => {
    expect(Fmt.humanize({ type: 'STEP_BEGAN', mode: 'WATCH', tick: 0 }, truth))
      .toMatchObject({ cls: 'head', msg: 'WATCH watch' });
    expect(Fmt.humanize({ type: 'CLOCK_ADVANCED', dt: 10, tick: 10 }, truth)).toBeNull();
    expect(Fmt.humanize({ type: 'MOVE_PROGRESS', formationId: 'f1' }, truth)).toBeNull();
  });

  it('resolves formation names from truth', () => {
    expect(Fmt.humanize(
      { type: 'FORMATION_MOVED', formationId: 'f1', to: { q: 5, r: 5 }, movedKind: 'NORMAL', onRoad: false },
      truth).msg).toBe('Vixen moves to 5,5');
  });

  it('reads a LOCK as a highlighted line', () => {
    const h = Fmt.humanize({ type: 'CONTACT_UPGRADED', tick: 1,
      contact: { observerSideId: 'blue', targetFormationId: 'f2', level: 4, estPos: { kind: 'ground', q: 6, r: 8 } } }, truth);
    expect(h.cls).toBe('warn');
    expect(h.msg).toBe('BLUE LOCKS Probe (hex 6,8)');
  });

  it('a battle is a big, gold line', () => {
    const h = Fmt.humanize({ type: 'ENGAGEMENT_TRIGGERED', engagement: {
      attackerSideId: 'blue', defenderSideId: 'red', attackerFormationIds: ['f1'],
      defenderFormationIds: ['f2'], hex: { q: 6, r: 8 } } }, truth);
    expect(h.cls).toBe('big');
    expect(h.msg).toContain('BATTLE — Vixen vs Probe at 6,8');
  });

  it('falls back to a readable line for unknown types — never raw JSON', () => {
    const h = Fmt.humanize({ type: 'SOME_NEW_EVENT', formationId: 'f1' }, truth);
    expect(h.msg).toBe('some new event — Vixen');
    expect(h.msg).not.toContain('{');
  });
});

describe('Fmt.contactLine / engBriefing', () => {
  it('contact line spells out level, position, and age', () => {
    const line = Fmt.contactLine({ level: 4, levelName: 'LOCK', estPos: { kind: 'ground', q: 6, r: 8 },
      estSizeClass: 'company', estComposition: '4×MECH', ageTicks: 1 });
    expect(line).toContain('LOCK');
    expect(line).toContain('hex 6,8');
    expect(line).toContain('company');
    expect(line).toContain('6 min old');
  });

  it('engagement briefing names attacker, defender, and the trigger', () => {
    const truth = { formations: { f1: { name: 'Castle' }, f2: { name: 'Probe' } }, facilities: {} };
    const b = Fmt.engBriefing({ trigger: 'STRIKE', hex: { q: 6, r: 8 }, attackerSideId: 'blue',
      defenderSideId: 'red', attackerFormationIds: ['f1'], defenderFormationIds: ['f2'] }, truth);
    expect(b).toContain('BLUE');
    expect(b).toContain('Castle');
    expect(b).toContain('Probe');
    expect(b).toContain('strike order reached its target');
  });
});

describe('Fmt.ownForce', () => {
  it('a ground formation reads in plain language', () => {
    const s = Fmt.ownForce({ name: 'Castle Company', pos: { kind: 'ground', q: 6, r: 8 },
      rdy: 7, emcon: 'DARK', posture: 'HIDE', onNet: true, currentOrder: { kind: 'MOVE' } });
    expect(s).toContain('Castle Company — hex 6,8');
    expect(s).toContain('readiness 7/10 (worn)');
    expect(s).toContain('silent (EMCON dark), hidden');
    expect(s).toContain('linked to command net');
    expect(s).toContain('ordered to move');
  });

  it('an off-net formation says so', () => {
    const s = Fmt.ownForce({ name: 'Scout', pos: { kind: 'ground', q: 1, r: 1 },
      rdy: 9, emcon: 'PASSIVE', posture: 'NONE', onNet: false });
    expect(s).toContain('off-net — running on standing orders');
  });

  it('an airborne flight shows fuel, joker/bingo, fatigue', () => {
    const s = Fmt.ownForce({ name: 'Anvil', rdy: 8, emcon: 'PASSIVE', posture: 'NONE', onNet: true,
      flight: { airPos: { q: 4, r: 8, band: 'HIGH' }, phase: 'ENROUTE', speed: 'CRUISE',
                fpMin: 240, jokerFp: 180, bingoFp: 120, fatigueMax: 3 } });
    expect(s).toContain('airborne 4,8 HIGH');
    expect(s).toContain('fuel 240 (joker 180 / bingo 120)');
    expect(s).toContain('fatigue 3');
  });
});

describe('Fmt status words', () => {
  it('emcon / posture / readiness bands', () => {
    expect(Fmt.emconWord('DARK')).toBe('silent (EMCON dark)');
    expect(Fmt.emconWord('ACTIVE')).toBe('active radar');
    expect(Fmt.postureWord('DUG_IN')).toBe('dug in');
    expect(Fmt.postureWord('NONE')).toBe('');
    expect(Fmt.rdyWord(10)).toBe('fresh');
    expect(Fmt.rdyWord(6)).toBe('worn');
    expect(Fmt.rdyWord(3)).toBe('spent');
    expect(Fmt.rdyWord(1)).toBe('broken');
  });
});
