/**
 * demo.ts — load a declarative campaign fixture (demo/campaign.json) into a TruthState.
 */
import { readFileSync } from 'node:fs';
import type { GroundPos, Order, TruthState } from './core/types.js';
import {
  addFormation, emptyTruth, mkFacility, mkFormation, mkSatellite, mkSide,
  mkTheater, mkUnit, type HexOverride,
} from './fixtures.js';

interface FixtureJson {
  seed: string;
  config: { name: string; dawnTick: number; duskTick: number; weather: 'CLEAR' | 'RAIN' | 'STORM' };
  theaters: Array<{ id: string; name: string; width: number; height: number;
                    defaultTerrain: string; overrides: HexOverride[] }>;
  sides: Array<{ id: string; name: string }>;
  facilities: Array<Record<string, any>>;
  satellites: Array<Record<string, any>>;
  formations: Array<Record<string, any>>;
  commandNodes: Record<string, string[]>;
  orders: Array<Record<string, any>>;
}

export function loadCampaignFixture(path: string): TruthState {
  const j: FixtureJson = JSON.parse(readFileSync(path, 'utf8'));
  const truth = emptyTruth(j.seed, j.config);

  for (const t of j.theaters) {
    truth.theaters[t.id] = mkTheater(
      t.id, t.name, t.width, t.height, t.defaultTerrain as any, t.overrides);
  }
  for (const s of j.sides) {
    truth.sides[s.id] = mkSide(s.id, s.name, j.commandNodes[s.id] ?? []);
  }
  for (const f of j.facilities) {
    truth.facilities[f.id] = mkFacility({
      id: f.id, sideId: f.sideId, name: f.name,
      pos: { kind: 'ground', theaterId: f.theaterId, q: f.q, r: f.r },
      tags: f.tags ?? [],
      supplyPoints: f.supplyPoints ?? 0,
      fuelFarmTons: f.fuelFarmTons ?? 0,
      isCommandNode: f.isCommandNode ?? false,
      sensorStation: f.sensorStation,
      turnaroundCrews: { total: f.turnaroundCrews ?? 1, busyUntil: [] },
    });
  }
  for (const sat of j.satellites) {
    truth.satellites[sat.id] = mkSatellite({
      id: sat.id, sideId: sat.sideId, kind: sat.kind, theaterId: sat.theaterId,
      corridor: sat.corridor, periodPulses: sat.periodPulses,
      nextPassTick: sat.nextPassTick ?? 0,
    });
  }
  for (const f of j.formations) {
    const formation = mkFormation({
      id: f.id, sideId: f.sideId, name: f.name,
      pos: { kind: 'ground', theaterId: f.theaterId, q: f.q, r: f.r },
      omp: f.omp, sigBase: f.sigBase,
      sns: f.sns, emcon: f.emcon ?? 'PASSIVE',
    });
    const units = (f.units ?? []).map((u: any) => mkUnit({
      sideId: f.sideId, name: u.name, model: u.model, class: u.class, tags: u.tags ?? [],
    }));
    addFormation(truth, formation, units);
  }
  for (const o of j.orders) {
    const theaterId = truth.formations[o.formationId].pos.kind === 'ground'
      ? (truth.formations[o.formationId].pos as GroundPos).theaterId : j.theaters[0].id;
    const order: Order = {
      id: o.id, sideId: o.sideId, formationId: o.formationId,
      issuedTick: 0, effectiveTick: o.effectiveTick ?? 0,
      kind: o.kind,
      path: (o.path ?? []).map((p: any) => ({ kind: 'ground', theaterId, q: p.q, r: p.r })),
      conditionals: (o.conditionals ?? []).map((c: any) => ({
        trigger: c.trigger,
        thenOrder: {
          id: 'ph', sideId: o.sideId, formationId: o.formationId, issuedTick: 0,
          effectiveTick: 0, kind: c.then.kind,
          ...(c.then.path ? { path: c.then.path.map((p: any) =>
            ({ kind: 'ground', theaterId, q: p.q, r: p.r })) } : {}),
          ...(c.then.targetContactId ? { targetContactId: c.then.targetContactId } : {}),
        },
      })),
      ...(o.targetContactId ? { targetContactId: o.targetContactId } : {}),
    };
    truth.orders[order.id] = order;
  }
  return truth;
}
