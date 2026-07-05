/**
 * projection/project.ts — project(truth, sideId, now) → ViewState. Pure. (spec §0, §4)
 *
 * The view is built exclusively from:
 *  - the side's own formations/ledgers (always visible),
 *  - DELIVERED contact snapshots (D-008.5) — never the live truth ladder,
 *  - delivered reports,
 *  - the side's scouted-terrain set.
 * Per-level reveal follows the spec §4 table exactly. Nothing here is ever persisted.
 */
import type { GroundPos, Id, Tick, TruthState } from '../core/types.js';
import { DEEPSKY, LADDER_NAMES } from '../rules.js';
import { isNight } from '../engine/clock.js';
import { netNodesOf } from '../engine/net.js';
import { supplyEnvelope } from '../engine/logistics.js';
import { formationSensors } from '../engine/detection.js';
import { groundHexUnder, isFlight, jokerBingo, minFp } from '../engine/air.js';
import { stallReason } from '../engine/stall.js';
import { burnDaysRemaining, transitDays } from '../engine/space.js';
import type { ContactView, KnownFacilityView, OwnFacilityView, OwnFormationView, OwnSatelliteView,
              ReportView, ScoutedHexView, SystemView, TheaterBoundsView,
              ViewState } from './viewTypes.js';

export function project(truth: TruthState, sideId: Id, now: Tick): ViewState {
  const side = truth.sides[sideId];
  if (!side) throw new Error(`unknown side ${sideId}`);

  const ownFormations: OwnFormationView[] = Object.values(truth.formations)
    .filter(f => f.sideId === sideId && !f.destroyed)
    .map(f => {
      const view: OwnFormationView = {
        id: f.id, name: f.name,
        pos: f.pos.kind === 'ground' ? { ...f.pos } : null,
        omp: f.omp, br: f.br, rdy: f.rdy,
        emcon: f.emcon, posture: f.posture,
        onNet: f.onNet,
        routed: f.routUntilTick != null && now < f.routUntilTick,
        currentOrder: f.currentOrderId && truth.orders[f.currentOrderId]
          ? { id: f.currentOrderId, kind: truth.orders[f.currentOrderId].kind,
              completed: !!truth.orders[f.currentOrderId].completed,
              // ext: why the order is waiting, in plain words (undefined = it's working)
              ...(stallReason(truth, f) ? { stall: stallReason(truth, f) } : {}),
              // own order: expose only the REMAINING waypoints (from where the unit is now)
              // so the map can draw a route that starts at the formation, not behind it
              path: (truth.orders[f.currentOrderId].path ?? [])
                .slice(f.pathIndex ?? 0)
                .filter((p): p is GroundPos => p.kind === 'ground')
                .map(p => ({ q: p.q, r: p.r })) }
          : undefined,
        units: f.unitIds.map(uid => {
          const u = truth.units[uid];
          return { id: u.id, name: u.name, model: u.model, class: u.class,
                   damage: u.damage, ammoState: u.ammoState, tags: [...u.tags] };
        }),
        inSupply: f.supply.inSupply,
      };
      // D-049: the queued plan — pending steps chained after the current order, in
      // execution order, so the panel can show "1. MOVE → 52,40 · 2. DIG_IN · …"
      {
        const byAfter = new Map<string, (typeof truth.orders)[string]>();
        for (const o of Object.values(truth.orders)) {
          if (o.formationId === f.id && !o.completed && o.afterOrderId) {
            byAfter.set(o.afterOrderId, o);
          }
        }
        const steps: NonNullable<OwnFormationView['plan']> = [];
        let cursor = f.currentOrderId;
        while (cursor && byAfter.has(cursor) && steps.length < 12) {
          const o = byAfter.get(cursor)!;
          const dest = o.targetHex ?? [...(o.path ?? [])].reverse()
            .find((p): p is GroundPos => p.kind === 'ground');
          steps.push({ kind: o.kind, ...(dest ? { dest: { q: dest.q, r: dest.r } } : {}) });
          cursor = o.id;
        }
        if (steps.length) view.plan = steps;
      }
      // D-049: standing rules, in plain terms for the rules panel
      if (f.rules?.length) {
        view.rules = f.rules.map(r => ({
          when: r.trigger.when, param: r.trigger.param, thenKind: r.thenOrder.kind,
          armed: r.armed !== false, repeat: !!r.repeat,
          ...(r.thenOrder.targetHex ? { targetHex: {
            q: r.thenOrder.targetHex.q, r: r.thenOrder.targetHex.r } } : {}),
        }));
      }
      // ext: carrier ops — own bays & rides
      if (f.carrier) {
        view.carrier = {
          bays: f.carrier.bays, crews: f.carrier.crews, avFuelTons: f.carrier.avFuelTons,
          aboard: Object.values(truth.formations)
            .filter(x => !x.destroyed && x.mounted?.carrierFormationId === f.id)
            .map(x => ({ id: x.id, name: x.name })),
        };
      }
      if (f.mounted) {
        const c = truth.formations[f.mounted.carrierFormationId];
        if (c) view.mountedOn = { id: c.id, name: c.name };
      }
      // own sensor reach (reflects derived probe/HQ gear) — for the inspect panel & rings
      if (f.pos.kind === 'ground') view.sensor = formationSensors(truth, f);
      if (f.alertState) view.alertState = f.alertState;
      // M4: a vessel's burn-day ledger is its own side's information, always
      if (f.pos.kind === 'node' || f.pos.kind === 'lane') {
        view.vessel = {
          spacePos: structuredClone(f.pos),
          burnDaysRemaining: Math.round(burnDaysRemaining(truth, f) * 100) / 100,
          fuelTons: Math.round(f.unitIds.reduce((sum, uid) =>
            sum + (truth.units[uid]?.fuel?.tons ?? 0), 0) * 100) / 100,
          drives: f.unitIds.filter(uid => truth.jumpDrives[uid]).map(uid => {
            const d = truth.jumpDrives[uid];
            return { unitId: uid, chargePct: Math.round(d.chargePct * 10) / 10,
                     sail: d.sail, kfDamage: d.kfDamage,
                     ...(d.lfBatteryCharged !== undefined
                       ? { lfBatteryCharged: d.lfBatteryCharged } : {}) };
          }),
        };
      }
      // M3: a flight's live ledger is its own side's information, always (SKYWATCH §2)
      if (isFlight(truth, f)) {
        const { joker, bingo } = jokerBingo(truth, f);
        const fatigues = f.unitIds.flatMap(uid =>
          (truth.units[uid]?.pilotIds ?? []).map(pid => truth.pilots[pid]?.fatigue ?? 0));
        // D-037 congruent sky: `overhead` is the ground hex directly below, so the map
        // can draw the flight where it actually is
        const over = f.pos.kind === 'air'
          ? groundHexUnder(truth, { q: f.pos.gridQ, r: f.pos.gridR }) : null;
        view.flight = {
          airPos: f.pos.kind === 'air'
            ? { q: f.pos.gridQ, r: f.pos.gridR, band: f.pos.band, altLevel: f.pos.altLevel }
            : null,
          overhead: over ? { theaterId: over.theaterId, q: over.q, r: over.r } : null,
          phase: f.air?.phase ?? 'GROUNDED',
          speed: f.air?.speed ?? 'CRUISE',
          fpMin: minFp(truth, f),
          jokerFp: Math.round(joker * 100) / 100,
          bingoFp: Math.round(bingo * 100) / 100,
          fatigueMax: fatigues.length ? Math.max(...fatigues) : 0,
          turnaroundReadyTick: f.air?.turnaroundReadyTick ?? null,
        };
      }
      return view;
    });

  const contacts: ContactView[] = Object.values(truth.contacts)
    .filter(c => c.observerSideId === sideId && c.delivered && c.delivered.level >= 1)
    .map(c => {
      const d = c.delivered!;
      const view: ContactView = {
        id: c.id,
        level: d.level,
        levelName: LADDER_NAMES[d.level],
        kind: c.kind,
        estPos: structuredClone(d.estPos) as ContactView['estPos'],
        posErrorHexes: d.posErrorHexes,
        staleAsOfTick: d.asOfTick,
        ageTicks: now - d.asOfTick,
      };
      // D-037: an air contact also carries the ground hex its estimate sits over
      if (d.estPos.kind === 'air') {
        const under = groundHexUnder(truth, { q: d.estPos.gridQ, r: d.estPos.gridR });
        if (under) view.overhead = { theaterId: under.theaterId, q: under.q, r: under.r };
      }
      // spec §4 reveal table — fields strictly by level
      if (d.level >= 2) {
        view.estVector = d.estVector;
        view.estSizeClass = d.estSizeClass;
      }
      if (d.level >= 3) view.estComposition = d.estComposition;
      if (d.level >= 4 && d.toe) view.toe = d.toe.map(t => ({ ...t }));
      return view;
    });

  const reports: ReportView[] = Object.values(truth.reports)
    .filter(r => r.sideId === sideId && r.deliveredTick !== null && !r.lost)
    .sort((a, b) => a.deliveredTick! - b.deliveredTick!)
    .map(r => ({ id: r.id, generatedTick: r.generatedTick,
                 deliveredTick: r.deliveredTick!, text: r.text }));

  const scoutedTerrain: ScoutedHexView[] = (truth.scoutedHexes[sideId] ?? [])
    .map(key => {
      const [theaterId, qr] = key.split(':');
      const hex = truth.theaters[theaterId]?.hexes[qr];
      if (!hex) return null;
      const v: ScoutedHexView = {
        theaterId, q: hex.q, r: hex.r, terrain: hex.terrain, infra: [...hex.infra],
      };
      // hidden objectives stay hidden (D-008.12); fake objectives render as real
      if (hex.objective && (!hex.objective.hidden || hex.objective.ownerSideId === sideId)) {
        v.objective = { vpPerDay: hex.objective.vpPerDay };
      }
      return v;
    })
    .filter((v): v is ScoutedHexView => v !== null);

  // M4: the subway-style system diagram — public geometry; secret pirate points stay
  // off the map until surveyed or revealed (DEEP SKY §1, §7.3)
  let system: SystemView | undefined;
  const nodeList = Object.values(truth.system.nodes);
  if (nodeList.length > 0) {
    const visible = nodeList.filter(n => !n.secret || n.surveyedBy.includes(sideId));
    const visibleIds = new Set(visible.map(n => n.id));
    system = {
      nodes: visible.map(n => ({ id: n.id, type: n.type, name: n.name,
                                 ...(n.theaterId ? { theaterId: n.theaterId } : {}) })),
      lanes: Object.values(truth.system.lanes)
        .filter(l => visibleIds.has(l.a) && visibleIds.has(l.b))
        .map(l => ({ id: l.id, a: l.a, b: l.b, distanceAU: l.distanceAU,
                     transitDays1G: Math.round(transitDays(l.distanceAU, 1) * 10) / 10 })),
    };
  }

  // M5: own infrastructure & eyes — always visible to their owner, never to others
  const ownFacilities: OwnFacilityView[] = Object.values(truth.facilities)
    .filter(f => f.sideId === sideId && f.pos.kind === 'ground')
    .map(f => ({ id: f.id, name: f.name, pos: { ...(f.pos as GroundPos) },
                 tags: [...f.tags], fuelFarmTons: f.fuelFarmTons,
                 supplyPoints: f.supplyPoints, isCommandNode: f.isCommandNode,
                 ...(f.sensorStation ? { sensor: { passive: f.sensorStation.passive,
                                                   active: f.sensorStation.active } } : {}),
                 ...(f.capitalBattery ? { capitalBattery: { ...f.capitalBattery } } : {}) }));
  // D-051.1: enemy installations this side has spotted — permanent once photographed.
  // The weapon on the pad is visible; the remaining magazine is not.
  const knownFacilities: KnownFacilityView[] = Object.values(truth.facilities)
    .filter(f => f.sideId !== sideId && f.pos.kind === 'ground' &&
                 (f.knownTo ?? []).includes(sideId))
    .map(f => ({ id: f.id, sideId: f.sideId, name: f.name,
                 pos: { ...(f.pos as GroundPos) }, tags: [...f.tags],
                 ...(f.capitalBattery ? { capitalBattery:
                   { weapon: f.capitalBattery.weapon } } : {}) }));
  // own satellites plus any whose launch was witnessed (core §8.6: schedule around them)
  const ownSatellites: OwnSatelliteView[] = Object.values(truth.satellites)
    .filter(s => s.sideId === sideId || s.knownTo.includes(sideId))
    .map(s => ({ id: s.id, kind: s.kind, theaterId: s.theaterId,
                 corridor: s.corridor.map(c => ({ ...c })),
                 periodPulses: s.periodPulses, nextPassTick: s.nextPassTick,
                 alive: s.alive }));
  // own command-net coverage — nodes AND chained relays (D-048) — so the player
  // can see where their forces stay on-net, and which links carry the line
  const netNodes = netNodesOf(truth, sideId)
    .filter(n => !n.theaterWide)
    .map(n => ({ q: n.pos.q, r: n.pos.r, theaterId: n.pos.theaterId, radius: n.radius,
                 ...(n.relay ? { relay: true } : {}) }));
  const netTheaterWide = netNodesOf(truth, sideId).some(n => n.theaterWide);
  // own supply envelope per theater (where a stocked depot/convoy can reach)
  const supplyHexes = Object.keys(truth.theaters).flatMap(thId =>
    supplyEnvelope(truth, sideId, thId).map(k => {
      const [q, r] = k.split(',').map(Number); return { q, r, theaterId: thId };
    }));
  // grid extent is public geography (paper maps exist); terrain stays scouted-only
  const theaters: TheaterBoundsView[] = Object.values(truth.theaters).map(t => {
    let cols = 0, rows = 0;
    for (const key of Object.keys(t.hexes)) {
      const [q, r] = key.split(',').map(Number);
      cols = Math.max(cols, q + 1);
      rows = Math.max(rows, r + 1);
    }
    return { id: t.id, name: t.name, cols, rows,
             airHex: truth.config.airHexByTheater?.[t.id] ?? { q: 0, r: 0 } };
  });

  return {
    sideId,
    now,
    clockMode: truth.clockMode,
    isNight: isNight(truth, now),
    vp: side.vp,
    ...(truth.config.vpThreshold !== undefined ? { vpThreshold: truth.config.vpThreshold } : {}),
    ...(truth.ended ? { ended: { ...truth.ended } } : {}),
    ownFormations,
    contacts,
    reports,
    scoutedTerrain,
    ...(system ? { system } : {}),
    ownFacilities,
    knownFacilities,
    ownSatellites,
    netNodes,
    netTheaterWide,
    supplyHexes,
    theaters,
  };
}
