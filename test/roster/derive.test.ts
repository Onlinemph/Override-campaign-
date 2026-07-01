import { describe, expect, it } from 'vitest';
import { deriveUnitFields, extractTags, type ParsedCardLike } from '../../src/roster/derive.js';

describe('extractTags — electronic-warfare gear from the record sheet', () => {
  it('reads Guardian ECM (spaced or MegaMek-joined) as ECM', () => {
    expect(extractTags('Guardian ECM Suite')).toContain('ECM');
    expect(extractTags('ISGuardianECM')).toContain('ECM');
    expect(extractTags('CLECM')).toContain('ECM');
  });

  it('reads Angel ECM as ANGEL_ECM and not plain ECM', () => {
    const tags = extractTags('AngelECM');
    expect(tags).toContain('ANGEL_ECM');
    expect(tags).not.toContain('ECM');
  });

  it('reads probes as BEAGLE', () => {
    expect(extractTags('Beagle Active Probe')).toContain('BEAGLE');
    expect(extractTags('ISBloodhoundActiveProbe')).toContain('BEAGLE');
  });

  it('a Watchdog / Nova CEWS suite is both ECM and a probe', () => {
    const tags = extractTags('ISWatchdogECM');
    expect(tags).toEqual(expect.arrayContaining(['ECM', 'BEAGLE']));
  });

  it('reads stealth armor, C3 Master, and Mobile HQ', () => {
    expect(extractTags('Armor:Stealth(Inner Sphere)')).toContain('STEALTH');
    expect(extractTags('ISC3MasterComputer')).toContain('C3M');
    expect(extractTags('Mobile HQ')).toContain('HQ');
  });

  it('does not tag a C3 Slave as a master', () => {
    expect(extractTags('ISC3SlaveUnit')).not.toContain('C3M');
  });

  it('a clean unit yields no EW tags', () => {
    expect(extractTags('Medium Laser\nMedium Laser\nHeat Sink')).toEqual([]);
  });

  it('adds WHEELED from the vehicle motion type', () => {
    expect(extractTags('AC/2', 'Wheeled')).toContain('WHEELED');
    expect(extractTags('AC/2', 'Tracked')).not.toContain('WHEELED');
  });
});

describe('deriveUnitFields — movement & class per kind', () => {
  it('a BattleMech carries walk/run/jump straight through', () => {
    const parsed: ParsedCardLike = { kind: 'mech', card: { walkMove: 4, runMove: 6, jump: 0 } };
    const d = deriveUnitFields(parsed, 'Guardian ECM', 5000);
    expect(d).toMatchObject({ class: 'MECH', walkOrCruise: 4, run: 6, jump: 0, bv: 5000 });
    expect(d.tags).toContain('ECM');
  });

  it('a combat vehicle maps cruise/flank + motion→class', () => {
    const tank: ParsedCardLike = { kind: 'vehicle', card: { cruiseMP: 4, flankMP: 6, motionType: 'Tracked' } };
    expect(deriveUnitFields(tank, '', 800)).toMatchObject({ class: 'VEHICLE', walkOrCruise: 4, run: 6 });
    const copter: ParsedCardLike = { kind: 'vehicle', card: { cruiseMP: 8, flankMP: 12, motionType: 'VTOL' } };
    expect(deriveUnitFields(copter, '').class).toBe('VTOL');
  });

  it('an aerospace fighter carries thrust and a fuel ledger', () => {
    const asf: ParsedCardLike = { kind: 'fighter', card: { safeThrust: 6, maxThrust: 9, conventional: false, fuel: 400 } };
    const d = deriveUnitFields(asf, '');
    expect(d).toMatchObject({ class: 'ASF', safeThrust: 6, maxThrust: 9 });
    expect(d.fuel).toMatchObject({ fp: 400, fpPerTon: 80, tons: 5 });
  });

  it('a conventional fighter is CONV_FIGHTER with the 160 fuel rate', () => {
    const cf: ParsedCardLike = { kind: 'fighter', card: { safeThrust: 5, maxThrust: 8, conventional: true, fuel: 320 } };
    const d = deriveUnitFields(cf, '');
    expect(d.class).toBe('CONV_FIGHTER');
    expect(d.fuel).toMatchObject({ fpPerTon: 160, tons: 2 });
  });

  it('battle armor uses ground MP for walk/run and its jump MP', () => {
    const ba: ParsedCardLike = { kind: 'battlearmor', card: { walkMP: 1, jumpMP: 3 } };
    expect(deriveUnitFields(ba, '')).toMatchObject({ class: 'BA', walkOrCruise: 1, run: 1, jump: 3 });
  });

  it('a protomech parses its printed move string', () => {
    const proto: ParsedCardLike = { kind: 'protomech', card: { move: '5 / 8 / 5j' } };
    expect(deriveUnitFields(proto, '')).toMatchObject({ class: 'PROTO', walkOrCruise: 5, run: 8, jump: 5 });
  });

  it('a dropship maps safe/max thrust', () => {
    const ds: ParsedCardLike = { kind: 'dropship', card: { safeThrust: 3, maxThrust: 5 } };
    expect(deriveUnitFields(ds, '')).toMatchObject({ class: 'DROPSHIP', safeThrust: 3, maxThrust: 5 });
  });

  it('maps the MUL Scout role to a RECON tag, but leaves other roles alone', () => {
    const mech: ParsedCardLike = { kind: 'mech', card: { walkMove: 8, runMove: 12, jump: 0 } };
    expect(deriveUnitFields(mech, '', undefined, 'Scout').tags).toContain('RECON');
    expect(deriveUnitFields(mech, '', undefined, 'Sniper').tags).not.toContain('RECON');
    expect(deriveUnitFields(mech, '', undefined, undefined).tags).not.toContain('RECON');
  });
});
