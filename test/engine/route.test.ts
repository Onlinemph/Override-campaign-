/** Auto-routing with ETA (D-041): the map plans the march; fog keeps it honest. */
import { describe, expect, it } from 'vitest';
import { findRoute } from '../../src/engine/route.js';
import { addMechFormation, baseTruth, gp, T } from '../helpers.js';

describe('findRoute', () => {
  it('detours a tank column around the mountain wall; mechs climb straight over', () => {
    // a north-south mountain wall at q=5, gap only at r=0 (the pass)
    const wall = Array.from({ length: 9 }, (_, r) =>
      ({ q: 5, r: r + 1, terrain: 'MOUNTAIN' as const }));
    const truth = baseTruth('ROUTE-1', wall, 12, 10);
    const tanks = addMechFormation(truth, { id: 't1', sideId: 'blue', pos: gp(2, 5), omp: 4 },
      2, { class: 'VEHICLE' });
    const mechs = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(2, 5), omp: 4 });

    const tankRoute = findRoute(truth, tanks, { q: 8, r: 5 })!;
    expect(tankRoute).not.toBeNull();
    // the column threads the pass at r=0 — no mountain hex on the route
    for (const p of tankRoute.path) {
      expect(truth.theaters[T].hexes[`${p.q},${p.r}`].terrain).not.toBe('MOUNTAIN');
    }
    expect(tankRoute.path.some(p => p.q === 5 && p.r === 0)).toBe(true);

    const mechRoute = findRoute(truth, mechs, { q: 8, r: 5 })!;
    expect(mechRoute.path.length).toBeLessThan(tankRoute.path.length); // straight over
    expect(mechRoute.etaTicks).toBeLessThan(tankRoute.etaTicks);
  });

  it('prefers the road and rides the rail — time optimized, not distance', () => {
    // direct route is 10 clear hexes; the rail line loops longer but runs at 12/h
    const rail = [
      ...Array.from({ length: 11 }, (_, q) => ({ q, r: 8, infra: ['RAIL' as const] })),
      { q: 0, r: 7, infra: ['RAIL' as const] }, { q: 10, r: 7, infra: ['RAIL' as const] },
    ];
    const truth = baseTruth('ROUTE-2', rail, 14, 10);
    const slow = addMechFormation(truth, { id: 's1', sideId: 'blue', pos: gp(0, 6), omp: 3 });
    const route = findRoute(truth, slow, { q: 10, r: 6 })!;
    // a slow battalion drops one row to the rail line and rides it
    expect(route.path.some(p => p.r === 8 || p.r === 7)).toBe(true);
    // ETA beats marching 10 hexes cross-country at 3/h (33 pulses = 330 ticks)
    expect(route.etaTicks).toBeLessThan(330);
  });

  it('fog discipline: an unscouted mountain range does not steer the route', () => {
    const wall = Array.from({ length: 10 }, (_, r) =>
      ({ q: 5, r, terrain: 'MOUNTAIN' as const }));
    const truth = baseTruth('ROUTE-3', wall, 12, 10);
    const tanks = addMechFormation(truth, { id: 't1', sideId: 'blue', pos: gp(2, 5) },
      2, { class: 'VEHICLE' });
    // blue has scouted nothing: the route confidently plots straight through
    truth.scoutedHexes['blue'] = [];
    const blind = findRoute(truth, tanks, { q: 8, r: 5 }, 'blue')!;
    expect(blind.path.some(p => p.q === 5 && p.r === 5)).toBe(true); // through the "clear"
    // the GM's route (omniscient) knows better: with the wall solid, no route exists
    expect(findRoute(truth, tanks, { q: 8, r: 5 })).toBeNull();
  });

  it('a bridge is the only way across, and the router finds it', () => {
    const river: Array<{ q: number; r: number; terrain: 'WATER';
                         infra?: Array<'ROAD' | 'BRIDGE'> }> =
      Array.from({ length: 10 }, (_, r) => ({ q: 6, r, terrain: 'WATER' as const }));
    river[4] = { q: 6, r: 4, terrain: 'WATER', infra: ['ROAD', 'BRIDGE'] };
    const truth = baseTruth('ROUTE-4', river, 12, 10);
    const col = addMechFormation(truth, { id: 'c1', sideId: 'blue', pos: gp(3, 8) });
    const route = findRoute(truth, col, { q: 9, r: 8 })!;
    expect(route).not.toBeNull();
    expect(route.path.some(p => p.q === 6 && p.r === 4)).toBe(true); // over the bridge
  });
});
