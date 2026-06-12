/** B6/B7 — detection TN assembly, ladder lifecycle, fade, ECM haze (core §6; spec §3.2). */
import { describe, expect, it } from 'vitest';
import {
  computeDetectionTN, detectionPass, fadePass, satellitePass,
} from '../../src/engine/detection.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { mkSatellite } from '../../src/fixtures.js';
import { addMechFormation, baseTruth, gp, moveOrder, T } from '../helpers.js';
import { hexDistance } from '../../src/hex/axial.js';
import type { GroundPos, TruthState } from '../../src/core/types.js';

function runDetection(truth: TruthState): GameEvent[] {
  const events: GameEvent[] = [];
  const emit = (e: GameEvent) => { events.push(e); applyEvent(truth, e); };
  detectionPass(truth, emit);
  return events;
}

const DAY = 100; // tick-of-day 100 ⇒ daylight (dawn 60 / dusk 180)

describe('B6 — TN assembly matrix (core §6.3, D-006)', () => {
  function tnFor(setup: (t: TruthState) => void, channel: 'PASSIVE_SENSOR' | 'ACTIVE_SENSOR' | 'VISUAL' = 'PASSIVE_SENSOR', night = false) {
    const truth = baseTruth('TN-SEED', [
      { q: 10, r: 5, terrain: 'WOODS' }, { q: 11, r: 5, terrain: 'URBAN' },
    ]);
    addMechFormation(truth, { id: 'tgt', sideId: 'red', pos: gp(9, 5), sigBase: 6 });
    setup(truth);
    return computeDetectionTN(truth, truth.formations['tgt'], channel, night);
  }

  it('base case: company, passive, stationary, clear, day ⇒ TN 6 with no mods', () => {
    const b = tnFor(() => {});
    expect(b.base).toBe(6);
    expect(b.mods).toEqual([]);
    expect(b.tn).toBe(6);
  });

  it('moving −1; forced −2; cautious +2 (D-006); road −1 stacks with motion', () => {
    expect(tnFor(t => { t.formations['tgt'].transient = { moved: 'NORMAL', onRoad: false, fired: false }; }).tn).toBe(5);
    expect(tnFor(t => { t.formations['tgt'].transient = { moved: 'FORCED', onRoad: false, fired: false }; }).tn).toBe(4);
    expect(tnFor(t => { t.formations['tgt'].transient = { moved: 'CAUTIOUS', onRoad: false, fired: false }; }).tn).toBe(8);
    expect(tnFor(t => { t.formations['tgt'].transient = { moved: 'NORMAL', onRoad: true, fired: false }; }).tn).toBe(4);
  });

  it('fired this turn −3', () => {
    expect(tnFor(t => { t.formations['tgt'].transient = { moved: 'NONE', onRoad: false, fired: true }; }).tn).toBe(3);
  });

  it('postures: hide +2, dug in +1', () => {
    expect(tnFor(t => { t.formations['tgt'].posture = 'HIDE'; }).tn).toBe(8);
    expect(tnFor(t => { t.formations['tgt'].posture = 'DUG_IN'; }).tn).toBe(7);
  });

  it('EMCON: DARK +2, ACTIVE −2 (reciprocity: lighting up makes YOU easier to find)', () => {
    expect(tnFor(t => { t.formations['tgt'].emcon = 'DARK'; }).tn).toBe(8);
    expect(tnFor(t => { t.formations['tgt'].emcon = 'ACTIVE'; }).tn).toBe(4);
  });

  it('terrain: woods +1; urban +2; urban infantry +3', () => {
    expect(tnFor(t => { t.formations['tgt'].pos = gp(10, 5); }).tn).toBe(7);
    expect(tnFor(t => { t.formations['tgt'].pos = gp(11, 5); }).tn).toBe(8);
    const inf = baseTruth('TN-SEED', [{ q: 11, r: 5, terrain: 'URBAN' }]);
    addMechFormation(inf, { id: 'tgt', sideId: 'red', pos: gp(11, 5), sigBase: 10 },
      1, { class: 'INFANTRY' });
    expect(computeDetectionTN(inf, inf.formations['tgt'], 'PASSIVE_SENSOR', false).tn).toBe(13);
  });

  it('night +2 vs passive & visual channels, NOT vs active sensors (D-006)', () => {
    expect(tnFor(() => {}, 'PASSIVE_SENSOR', true).tn).toBe(8);
    expect(tnFor(() => {}, 'VISUAL', true).tn).toBe(8);
    expect(tnFor(() => {}, 'ACTIVE_SENSOR', true).tn).toBe(6);
  });

  it('rain +1 (all sensors)', () => {
    expect(tnFor(t => { t.config.weather = 'RAIN'; }).tn).toBe(7);
  });

  it('ECM: Guardian +1, Angel +2; stealth single +2', () => {
    expect(tnFor(t => { t.units[t.formations['tgt'].unitIds[0]].tags = ['ECM']; }).tn).toBe(7);
    expect(tnFor(t => { t.units[t.formations['tgt'].unitIds[0]].tags = ['ANGEL_ECM']; }).tn).toBe(8);
    const truth = baseTruth('TN-SEED');
    addMechFormation(truth, { id: 'tgt', sideId: 'red', pos: gp(9, 5), sigBase: 9 },
      1, { tags: ['STEALTH'] });
    expect(computeDetectionTN(truth, truth.formations['tgt'], 'PASSIVE_SENSOR', false).tn).toBe(11);
  });

  it('the core 6.5 play: battalion DARK in woods on a rainy night ⇒ TN 11 (5+2+1+1+2)', () => {
    const truth = baseTruth('TN-SEED', [{ q: 9, r: 5, terrain: 'WOODS' }]);
    truth.config.weather = 'RAIN';
    addMechFormation(truth, { id: 'bn', sideId: 'red', pos: gp(9, 5), sigBase: 5 });
    truth.formations['bn'].emcon = 'DARK';
    expect(computeDetectionTN(truth, truth.formations['bn'], 'PASSIVE_SENSOR', true).tn).toBe(11);
  });
});

describe('B6 — pass mechanics', () => {
  it('out of range: no roll at all (no DIE_ROLLED event)', () => {
    const truth = baseTruth('PASS-SEED');
    truth.tick = DAY;
    addMechFormation(truth, { id: 's', sideId: 'blue', pos: gp(0, 0) }); // passive 2
    addMechFormation(truth, { id: 't', sideId: 'red', pos: gp(10, 0) });
    expect(runDetection(truth).filter(e => e.type === 'DIE_ROLLED')).toHaveLength(0);
  });

  it('in passive range: exactly one logged roll per searcher/target pair, cursor advances', () => {
    const truth = baseTruth('PASS-SEED');
    truth.tick = DAY;
    addMechFormation(truth, { id: 's', sideId: 'blue', pos: gp(0, 0) });
    addMechFormation(truth, { id: 't', sideId: 'red', pos: gp(2, 0) });
    const c0 = truth.seedCursor;
    const rolls = runDetection(truth).filter(e => e.type === 'DIE_ROLLED');
    expect(rolls).toHaveLength(2); // blue rolls on red AND red rolls on blue
    expect(truth.seedCursor).toBe(c0 + 4);
  });

  it('EMCON ACTIVE doubles reach (active range) and adds +2 to the roll', () => {
    const truth = baseTruth('PASS-SEED');
    truth.tick = DAY;
    addMechFormation(truth, { id: 's', sideId: 'blue', pos: gp(0, 0), emcon: 'ACTIVE' });
    addMechFormation(truth, { id: 't', sideId: 'red', pos: gp(4, 0) }); // beyond passive 2, within active 4
    const events = runDetection(truth);
    const roll = events.find(e => e.type === 'DIE_ROLLED') as any;
    expect(roll).toBeTruthy();
    expect(roll.roll.purpose).toContain('+2');
  });

  it('visual channel: eyeball 3 hexes by day with clear LOS; hills block; night cuts to 1', () => {
    // day, distance 3, clear: visual roll happens
    const day = baseTruth('PASS-SEED');
    day.tick = DAY;
    addMechFormation(day, { id: 's', sideId: 'blue', pos: gp(0, 0) });
    addMechFormation(day, { id: 't', sideId: 'red', pos: gp(3, 0) });
    expect(runDetection(day).filter(e => e.type === 'DIE_ROLLED').length).toBeGreaterThan(0);

    // hills in between: LOS blocked, no roll
    const blocked = baseTruth('PASS-SEED', [{ q: 1, r: 0, terrain: 'HILLS' }]);
    blocked.tick = DAY;
    addMechFormation(blocked, { id: 's', sideId: 'blue', pos: gp(0, 0) });
    addMechFormation(blocked, { id: 't', sideId: 'red', pos: gp(3, 0) });
    expect(runDetection(blocked).filter(e => e.type === 'DIE_ROLLED')).toHaveLength(0);

    // night: eyeball range 1, distance 3 ⇒ no roll
    const night = baseTruth('PASS-SEED');
    night.tick = 0;
    addMechFormation(night, { id: 's', sideId: 'blue', pos: gp(0, 0) });
    addMechFormation(night, { id: 't', sideId: 'red', pos: gp(3, 0) });
    expect(runDetection(night).filter(e => e.type === 'DIE_ROLLED')).toHaveLength(0);
  });

  it('facility sensor stations search (always-on-net source delivers instantly)', () => {
    const truth = baseTruth('PASS-SEED');
    truth.tick = DAY;
    truth.facilities['st'] = {
      id: 'st', sideId: 'blue', name: 'Station Echo', pos: gp(0, 0), tags: ['SENSOR_STATION'],
      fuelFarmTons: 0, supplyPoints: 0, turnaroundCrews: { total: 1, busyUntil: [] },
      isCommandNode: false, sensorStation: { passive: 6, active: 12 },
    };
    addMechFormation(truth, { id: 't', sideId: 'red', pos: gp(5, 0), sigBase: 2 }); // TN ≤ 2: certain
    const events = runDetection(truth);
    expect(events.some(e => e.type === 'CONTACT_UPGRADED')).toBe(true);
    expect(events.some(e => e.type === 'REPORT_DELIVERED')).toBe(true);
  });
});

describe('B7 — ladder lifecycle', () => {
  it('climbs +1 per success and caps at LOCK (4)', () => {
    const truth = baseTruth('LADDER-SEED');
    truth.tick = DAY;
    addMechFormation(truth, { id: 's', sideId: 'blue', pos: gp(0, 0) });
    addMechFormation(truth, { id: 't', sideId: 'red', pos: gp(2, 0), sigBase: 2 }); // always detected
    for (let i = 1; i <= 6; i++) {
      runDetection(truth);
      truth.tick += 1;
      const c = truth.contacts['contact:blue:t'];
      expect(c.level).toBe(Math.min(4, i));
    }
  });

  it('GHOST: estPos within ±1 hex of true position, deterministic for same inputs', () => {
    const truth = baseTruth('GHOST-SEED');
    truth.tick = DAY;
    addMechFormation(truth, { id: 's', sideId: 'blue', pos: gp(0, 0) });
    addMechFormation(truth, { id: 't', sideId: 'red', pos: gp(2, 0), sigBase: 2 });
    runDetection(truth);
    const c = truth.contacts['contact:blue:t'];
    expect(c.level).toBe(1);
    expect(c.posErrorHexes).toBe(1);
    expect(hexDistance(c.estPos as GroundPos, gp(2, 0))).toBeLessThanOrEqual(1);

    const truth2 = baseTruth('GHOST-SEED');
    truth2.tick = DAY;
    addMechFormation(truth2, { id: 's', sideId: 'blue', pos: gp(0, 0) });
    addMechFormation(truth2, { id: 't', sideId: 'red', pos: gp(2, 0), sigBase: 2 });
    runDetection(truth2);
    expect(truth2.contacts['contact:blue:t'].estPos).toEqual(c.estPos);
  });

  it('fields fill by level: SHADOW adds vector+size, CONTACT composition, LOCK TO&E', () => {
    const truth = baseTruth('FIELDS-SEED');
    truth.tick = DAY;
    addMechFormation(truth, { id: 's', sideId: 'blue', pos: gp(0, 0) });
    addMechFormation(truth, { id: 't', sideId: 'red', pos: gp(2, 0), sigBase: 2 });
    truth.formations['t'].lastHeadingDeg = 120;

    runDetection(truth); truth.tick++;
    const ghost = truth.contacts['contact:blue:t'];
    expect(ghost.estSizeClass).toBeUndefined();
    expect(ghost.estComposition).toBeUndefined();

    runDetection(truth); truth.tick++;
    const shadow = truth.contacts['contact:blue:t'];
    expect(shadow.level).toBe(2);
    expect(shadow.estVector).toBe(120);
    expect(shadow.estSizeClass).toBeTruthy();
    expect(shadow.posErrorHexes).toBe(0);
    expect(shadow.estPos).toEqual(gp(2, 0));
    expect(shadow.estComposition).toBeUndefined();

    runDetection(truth); truth.tick++;
    expect(truth.contacts['contact:blue:t'].estComposition).toContain('MECH');

    runDetection(truth); truth.tick++;
    const lock = truth.contacts['contact:blue:t'];
    expect(lock.level).toBe(4);
  });

  it('same hex ⇒ automatic mutual LOCK (core §6.4)', () => {
    const truth = baseTruth('SAMEHEX-SEED');
    truth.tick = DAY;
    addMechFormation(truth, { id: 'a', sideId: 'blue', pos: gp(5, 5), sigBase: 12 });
    addMechFormation(truth, { id: 'b', sideId: 'red', pos: gp(5, 5), sigBase: 12 });
    runDetection(truth);
    expect(truth.contacts['contact:blue:b'].level).toBe(4);
    expect(truth.contacts['contact:red:a'].level).toBe(4);
  });

  it('fade: −1 level per pulse without redetect, down to removal (core §6.4)', () => {
    const truth = baseTruth('FADE-SEED');
    truth.contacts['c'] = {
      id: 'c', observerSideId: 'blue', targetFormationId: 'x', kind: 'STANDARD',
      level: 3, lastConfirmedTick: 0, lastFadeTick: 0,
      estPos: gp(1, 1), posErrorHexes: 0, staleAsOfTick: 0,
    };
    const events: GameEvent[] = [];
    const emit = (e: GameEvent) => { events.push(e); applyEvent(truth, e); };

    truth.tick = 9; fadePass(truth, emit);
    expect(truth.contacts['c'].level).toBe(3); // not a full pulse yet

    truth.tick = 10; fadePass(truth, emit);
    expect(truth.contacts['c'].level).toBe(2);

    truth.tick = 25; fadePass(truth, emit);   // 1.5 more pulses ⇒ one more step
    expect(truth.contacts['c'].level).toBe(1);

    truth.tick = 30; fadePass(truth, emit);
    expect(truth.contacts['c']).toBeUndefined(); // GHOST faded to nothing
    expect(events.at(-1)?.type).toBe('CONTACT_REMOVED');
  });

  it('ECM haze: ACTIVE searcher sees a haze anomaly at a hostile ECM bubble in range', () => {
    const truth = baseTruth('HAZE-SEED');
    truth.tick = DAY;
    addMechFormation(truth, { id: 's', sideId: 'blue', pos: gp(0, 0), emcon: 'ACTIVE' });
    addMechFormation(truth, { id: 'e', sideId: 'red', pos: gp(3, 0), sigBase: 12 },
      4, { tags: ['ECM'] });
    runDetection(truth);
    const haze = truth.contacts['haze:blue:e'];
    expect(haze).toBeTruthy();
    expect(haze.kind).toBe('ECM_HAZE');
    expect(haze.estPos).toEqual(gp(3, 0)); // the bubble hex, not an identification
  });
});

describe('B7 — satellite passes (core §8.6)', () => {
  it('scans its 10-wide track on schedule, reschedules +4 pulses, owner gets the report instantly', () => {
    const truth = baseTruth('SAT-SEED');
    truth.tick = 100;
    truth.satellites['sat'] = mkSatellite({
      id: 'sat', sideId: 'blue', theaterId: T,
      corridor: [{ q: 0, r: 5 }, { q: 29, r: 5 }], nextPassTick: 100,
    });
    addMechFormation(truth, { id: 'in', sideId: 'red', pos: gp(10, 7), sigBase: 2 });  // 2 off-center: inside
    addMechFormation(truth, { id: 'out', sideId: 'red', pos: gp(10, 13), sigBase: 2 }); // 8 off: outside

    const events: GameEvent[] = [];
    const emit = (e: GameEvent) => { events.push(e); applyEvent(truth, e); };
    satellitePass(truth, emit);

    expect(truth.contacts['contact:blue:in']).toBeTruthy();
    expect(truth.contacts['contact:blue:out']).toBeUndefined();
    expect(events.some(e => e.type === 'REPORT_DELIVERED')).toBe(true);
    expect(truth.satellites['sat'].nextPassTick).toBe(140); // +4 pulses

    // before the next window: no scan
    truth.tick = 120;
    const quiet: GameEvent[] = [];
    satellitePass(truth, e => { quiet.push(e); applyEvent(truth, e); });
    expect(quiet).toHaveLength(0);
  });
});
