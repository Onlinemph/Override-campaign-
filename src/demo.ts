/**
 * demo.ts — load a declarative campaign fixture (demo/campaign.json) into a TruthState.
 */
import { readFileSync } from 'node:fs';
import type {
  Formation, GroundPos, JumpDrive, Marker, Order, Pilot, Position, TruthState, Unit,
} from './core/types.js';
import {
  addFormation, emptyTruth, mkFacility, mkFormation, mkSatellite, mkSide,
  mkTheater, mkUnit, type HexOverride,
} from './fixtures.js';
import { validateCampaign } from './campaign/schema.js';

interface FixtureJson {
  seed: string;
  config: { name: string; dawnTick: number; duskTick: number; weather: 'CLEAR' | 'RAIN' | 'STORM';
            airHexByTheater?: Record<string, { q: number; r: number }>;
            vpThreshold?: number; endTick?: number };
  theaters: Array<{ id: string; name: string; width: number; height: number;
                    defaultTerrain: string; overrides: HexOverride[] }>;
  sides: Array<{ id: string; name: string }>;
  facilities: Array<Record<string, any>>;
  satellites: Array<Record<string, any>>;
  formations: Array<Record<string, any>>;
  commandNodes: Record<string, string[]>;
  orders: Array<Record<string, any>>;
  system?: { nodes: Array<Record<string, any>>; lanes: Array<Record<string, any>> };
  markers?: Array<Record<string, any>>;
}

export function loadCampaignFixture(path: string): TruthState {
  return buildCampaign(JSON.parse(readFileSync(path, 'utf8')), path);
}

/**
 * Build the entities for one declarative formation spec (the same shape used in
 * `formations[]` of a campaign file). Returns the pieces without touching any TruthState,
 * so it serves both the bulk loader and runtime GM reinforcement (Campaign.spawnFormation).
 * The formation comes back with `unitIds` populated, as FORMATION_SPAWNED expects.
 */
export function buildFormationEntities(f: any):
    { formation: Formation; units: Unit[]; pilots: Pilot[]; jumpDrives: JumpDrive[] } {
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
    posture: f.posture, rdy: f.rdy, facing: f.facing,
    carriedSp: f.carriedSp, squawk: f.squawk, neutral: f.neutral,
    ...(f.mountedOn ? { mounted: { carrierFormationId: f.mountedOn } } : {}),
  });
  if (f.flight || f.airPos) {
    formation.air = { phase: f.airPos ? 'ENROUTE' : 'GROUNDED', speed: 'CRUISE',
                      homeFacilityId: f.flight?.homeFacilityId };
  }
  const pilots: Pilot[] = [];
  const jumpDrives: JumpDrive[] = [];
  const units = (f.units ?? []).map((u: any, i: number) => {
    const unit = mkUnit({
      id: `${f.id}-u${i + 1}`,
      sideId: f.sideId, name: u.name, model: u.model, class: u.class, tags: u.tags ?? [],
      safeThrust: u.safeThrust, maxThrust: u.maxThrust,
      damage: u.damage, ammoState: u.ammoState,
      bv: u.bv, pv: u.pv, walkOrCruise: u.walkOrCruise, run: u.run, jump: u.jump,
      fuel: u.fuelFp ? { fp: u.fuelFp, fpPerTon: u.fpPerTon ?? 80,
                         tons: u.fuelTons ?? u.fuelFp / (u.fpPerTon ?? 80) }
        : u.fuelTons ? { fp: 0, fpPerTon: u.fpPerTon ?? 30, tons: u.fuelTons,
                         tonsPerBurnDay: u.tonsPerBurnDay ?? 1.84 } : undefined,
    });
    // pilot: a bare name string (regular 4/5) or a full object
    if (u.pilot) {
      const pj = typeof u.pilot === 'string' ? { name: u.pilot } : u.pilot;
      const pilot: Pilot = { id: `${f.id}-pilot-${i + 1}`, name: pj.name ?? `${f.id} crew ${i + 1}`,
        gunnery: pj.gunnery ?? 4, piloting: pj.piloting ?? 5,
        kills: pj.kills ?? 0, ace: pj.ace ?? false, fatigue: pj.fatigue ?? 0,
        status: pj.status ?? 'OK' };
      pilots.push(pilot);
      unit.pilotIds = [pilot.id];
    }
    // K-F drive on a jump-capable hull
    if (u.drive) {
      jumpDrives.push({
        vesselUnitId: unit.id, chargePct: u.drive.chargePct ?? 0,
        chargeRateHrsTo100: u.drive.chargeRateHrsTo100 ?? 180,
        sail: u.drive.sail ?? 'STOWED', kfDamage: u.drive.kfDamage ?? 'NONE',
        ...(u.drive.lfBatteryCharged !== undefined ? { lfBatteryCharged: u.drive.lfBatteryCharged } : {}),
      });
    }
    return unit;
  });
  formation.unitIds = units.map((u: Unit) => u.id);
  return { formation, units, pilots, jumpDrives };
}

/** Build truth from a parsed campaign object, validating first with friendly errors. */
export function buildCampaign(j: FixtureJson, source = 'campaign'): TruthState {
  const problems = validateCampaign(j);
  if (problems.length > 0) {
    throw new Error(`${source} has ${problems.length} problem(s):\n  - ` + problems.join('\n  - '));
  }
  const truth = emptyTruth(j.seed, j.config);

  for (const t of j.theaters) {
    truth.theaters[t.id] = mkTheater(
      t.id, t.name, t.width, t.height, t.defaultTerrain as any, t.overrides);
  }
  for (const s of j.sides) {
    truth.sides[s.id] = mkSide(s.id, s.name, j.commandNodes[s.id] ?? []);
    if ((s as any).vp !== undefined) truth.sides[s.id].vp = (s as any).vp;
    if ((s as any).importSpPerDay !== undefined) truth.sides[s.id].importSpPerDay = (s as any).importSpPerDay;
    if ((s as any).homeDepotId !== undefined) truth.sides[s.id].homeDepotId = (s as any).homeDepotId;
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
  if (j.config.vpThreshold !== undefined) truth.config.vpThreshold = j.config.vpThreshold;
  if (j.config.endTick !== undefined) truth.config.endTick = j.config.endTick;
  for (const n of j.system?.nodes ?? []) {
    truth.system.nodes[n.id] = {
      id: n.id, type: n.type, name: n.name ?? n.id,
      surveyedBy: n.surveyedBy ?? [], secret: n.secret ?? false,
      ...(n.theaterId ? { theaterId: n.theaterId } : {}),
      ...(n.objective ? { objective: { vpPerDay: n.objective.vpPerDay,
                                       ownerSideId: n.objective.ownerSideId } } : {}),
    };
  }
  for (const l of j.system?.lanes ?? []) {
    const id = l.id ?? `${l.a}--${l.b}`;
    truth.system.lanes[id] = { id, a: l.a, b: l.b, distanceAU: l.distanceAU };
  }
  for (const f of j.formations) {
    const { formation, units, pilots, jumpDrives } = buildFormationEntities(f);
    for (const p of pilots) truth.pilots[p.id] = p;
    for (const d of jumpDrives) truth.jumpDrives[d.vesselUnitId] = d;
    addFormation(truth, formation, units);
  }

  // ── markers (minefields, downed crew, fuel caches, sentinel drones, wrecks) ──
  for (const m of j.markers ?? []) {
    const pos: Position = m.nodeId
      ? { kind: 'node', nodeId: m.nodeId }
      : { kind: 'ground', theaterId: m.theaterId, q: m.q, r: m.r };
    const marker: Marker = {
      id: m.id, kind: m.kind, pos, payload: m.payload ?? {},
      ...(m.sideId ? { sideId: m.sideId } : {}),
      ...(m.beaconActive !== undefined ? { beaconActive: m.beaconActive } : {}),
    };
    truth.markers[marker.id] = marker;
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
