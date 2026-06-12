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
  config: { name: string; dawnTick: number; duskTick: number; weather: 'CLEAR' | 'RAIN' | 'STORM';
            airHexByTheater?: Record<string, { q: number; r: number }> };
  theaters: Array<{ id: string; name: string; width: number; height: number;
                    defaultTerrain: string; overrides: HexOverride[] }>;
  sides: Array<{ id: string; name: string }>;
  facilities: Array<Record<string, any>>;
  satellites: Array<Record<string, any>>;
  formations: Array<Record<string, any>>;
  commandNodes: Record<string, string[]>;
  orders: Array<Record<string, any>>;
  system?: { nodes: Array<Record<string, any>>; lanes: Array<Record<string, any>> };
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
      activeSweep: f.activeSweep ?? false,
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
  for (const n of j.system?.nodes ?? []) {
    truth.system.nodes[n.id] = {
      id: n.id, type: n.type, name: n.name ?? n.id,
      surveyedBy: n.surveyedBy ?? [], secret: n.secret ?? false,
      ...(n.theaterId ? { theaterId: n.theaterId } : {}),
    };
  }
  for (const l of j.system?.lanes ?? []) {
    const id = l.id ?? `${l.a}--${l.b}`;
    truth.system.lanes[id] = { id, a: l.a, b: l.b, distanceAU: l.distanceAU };
  }
  for (const f of j.formations) {
    const pos = f.nodeId
      ? { kind: 'node' as const, nodeId: f.nodeId }
      : f.airPos
      ? { kind: 'air' as const, gridQ: f.airPos.q, gridR: f.airPos.r,
          band: (f.airPos.band ?? 'HIGH') as 'HIGH', altLevel: f.airPos.altLevel ?? 6,
          velocity: 2, vectorDeg: 0 }
      : { kind: 'ground' as const, theaterId: f.theaterId, q: f.q, r: f.r };
    const formation = mkFormation({
      id: f.id, sideId: f.sideId, name: f.name, pos,
      omp: f.omp ?? 0, sigBase: f.sigBase,
      sns: f.sns, emcon: f.emcon ?? 'PASSIVE',
      alertState: f.alertState,
    });
    if (f.flight || f.airPos) {
      formation.air = { phase: f.airPos ? 'ENROUTE' : 'GROUNDED', speed: 'CRUISE',
                        homeFacilityId: f.flight?.homeFacilityId };
    }
    const units = (f.units ?? []).map((u: any, i: number) => {
      const unit = mkUnit({
        id: `${f.id}-u${i + 1}`,
        sideId: f.sideId, name: u.name, model: u.model, class: u.class, tags: u.tags ?? [],
        safeThrust: u.safeThrust,
        fuel: u.fuelFp ? { fp: u.fuelFp, fpPerTon: 80, tons: u.fuelTons ?? u.fuelFp / 80 }
          : u.fuelTons ? { fp: 0, fpPerTon: 30, tons: u.fuelTons,
                           tonsPerBurnDay: u.tonsPerBurnDay ?? 1.84 } : undefined,
        maxThrust: u.maxThrust,
      });
      if (u.pilot) {
        const pilot = { id: `${f.id}-pilot-${i + 1}`, name: u.pilot, gunnery: 4, piloting: 5,
                        kills: 0, ace: false, fatigue: 0, status: 'OK' as const };
        truth.pilots[pilot.id] = pilot;
        unit.pilotIds = [pilot.id];
      }
      return unit;
    });
    addFormation(truth, formation, units);
  }
  for (const o of j.orders) {
    const theaterId = truth.formations[o.formationId].pos.kind === 'ground'
      ? (truth.formations[o.formationId].pos as GroundPos).theaterId : j.theaters[0].id;
    const airStation = o.airStation
      ? { kind: 'air' as const, gridQ: o.airStation.q, gridR: o.airStation.r,
          band: 'HIGH' as const, altLevel: 6, velocity: 0, vectorDeg: 0 }
      : undefined;
    const order: Order = {
      id: o.id, sideId: o.sideId, formationId: o.formationId,
      issuedTick: 0, effectiveTick: o.effectiveTick ?? 0,
      kind: o.kind,
      ...(airStation ? { station: airStation } : {}),
      ...(o.airSpeed ? { airSpeed: o.airSpeed } : {}),
      ...(o.loiterTicks !== undefined ? { loiterTicks: o.loiterTicks } : {}),
      ...(o.emconOverride ? { emconOverride: o.emconOverride } : {}),
      path: (o.path ?? []).map((p: any) => o.airPath
        ? { kind: 'air', gridQ: p.q, gridR: p.r, band: 'HIGH', altLevel: 6, velocity: 0, vectorDeg: 0 }
        : { kind: 'ground', theaterId, q: p.q, r: p.r }),
      conditionals: (o.conditionals ?? []).map((c: any) => ({
        trigger: c.trigger,
        thenOrder: {
          id: 'ph', sideId: o.sideId, formationId: o.formationId, issuedTick: 0,
          effectiveTick: 0, kind: c.then.kind,
          ...(c.then.path ? { path: c.then.path.map((p: any) =>
            ({ kind: 'ground', theaterId, q: p.q, r: p.r })) } : {}),
          ...(c.then.targetContactId ? { targetContactId: c.then.targetContactId } : {}),
          ...(c.then.airSpeed ? { airSpeed: c.then.airSpeed } : {}),
          ...(c.then.loiterTicks !== undefined ? { loiterTicks: c.then.loiterTicks } : {}),
        },
      })),
      ...(o.targetContactId ? { targetContactId: o.targetContactId } : {}),
    };
    truth.orders[order.id] = order;
  }
  return truth;
}
