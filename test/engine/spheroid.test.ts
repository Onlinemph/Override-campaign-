/** Spheroid hulls (ext): 1 air hex per contact turn — the fast lane is orbit. */
import { describe, expect, it } from 'vitest';
import { Campaign } from '../../src/core/truth.js';
import { atmoHexesPerTick, cruiseHexesPerTick } from '../../src/engine/air.js';
import { extractTags } from '../../src/roster/derive.js';
import { SKYWATCH } from '../../src/rules.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

function activate(truth: TruthState, order: Order) {
  truth.orders[order.id] = order;
  truth.formations[order.formationId].currentOrderId = order.id;
}

function dropship(truth: TruthState, id: string, tags: string[]) {
  const f = addMechFormation(truth, { id, sideId: 'blue', pos: gp(2, 2) },
    1, { class: 'DROPSHIP', tags, safeThrust: 3 });
  f.air = { phase: 'ENROUTE', speed: 'CRUISE' };
  f.pos = { kind: 'air', gridQ: 0, gridR: 0, band: 'HIGH', altLevel: 6,
            velocity: 2, vectorDeg: 0 };
  const u = truth.units[f.unitIds[0]];
  u.fuel = { fp: 4000, fpPerTon: 30, tons: 4000 / 30 };
  return f;
}

describe('the hull shape derives from the record sheet', () => {
  it('motion_type (or the raw block) tags SPHEROID / AERODYNE', () => {
    expect(extractTags('', 'Spheroid')).toContain('SPHEROID');
    expect(extractTags('', 'Aerodyne')).toContain('AERODYNE');
    expect(extractTags('<motion_type>\nSpheroid\n</motion_type>')).toContain('SPHEROID');
    expect(extractTags('a plain mech sheet')).not.toContain('SPHEROID');
  });
});

describe('spheroids crawl in atmosphere', () => {
  it('1 air hex per contact turn, cruise or dash — thrust be damned', () => {
    const truth = baseTruth('SPHERE-1');
    const egg = dropship(truth, 'egg', ['SPHEROID']);
    const wing = dropship(truth, 'wing', ['AERODYNE']);
    expect(atmoHexesPerTick(truth, egg, 'CRUISE')).toBe(SKYWATCH.SPHEROID_ATMO_HEX_PER_TICK);
    expect(atmoHexesPerTick(truth, egg, 'DASH')).toBe(SKYWATCH.SPHEROID_ATMO_HEX_PER_TICK);
    expect(atmoHexesPerTick(truth, wing, 'CRUISE')).toBe(cruiseHexesPerTick());
  });

  it('the same LAND order: the aerodyne is down while the spheroid is still wallowing', () => {
    const mk = (tags: string[]) => {
      const truth = baseTruth('SPHERE-RACE');
      const ds = dropship(truth, 'ds', tags);
      activate(truth, { ...moveOrder('o1', ds, 'MOVE', []), kind: 'LAND',
                        targetHex: gp(10, 10), path: [] });
      truth.config.airHexByTheater = { 'theater-1': { q: 10, r: 10 } }; // 20 air hexes out
      return Campaign.create(truth);
    };
    const wing = mk(['AERODYNE']);
    for (let i = 0; i < 3; i++) wing.step('CONTACT');
    expect(wing.truth.formations['ds'].pos).toEqual(gp(10, 10)); // 12 hexes/turn: down fast

    const egg = mk(['SPHEROID']);
    for (let i = 0; i < 3; i++) egg.step('CONTACT');
    expect(egg.truth.formations['ds'].pos.kind).toBe('air');     // 3 turns: 3 of 20 hexes
    for (let i = 0; i < 20; i++) egg.step('CONTACT');
    expect(egg.truth.formations['ds'].pos).toEqual(gp(10, 10));  // two hours later, it lands
  });
});
