/**
 * core/events.ts — the append-only event vocabulary and the reducer.
 * Truth State is mutated ONLY by applyEvent (spec §0). The tick engine emits events;
 * it never touches state directly.
 */
import type {
  AirPos, ClockMode, Contact, ContactReport, DamageState, DieRoll, Engagement,
  Formation, GroundPos, HandoffPackage, Id, Marker, Order, Pilot, Posture,
  SalvageToken, TruthState, Tick, Unit,
} from './types.js';
import { SKYWATCH } from '../rules.js';

export type GameEvent =
  | { type: 'CAMPAIGN_INIT'; state: TruthState }
  | { type: 'STEP_BEGAN'; tick: Tick; mode: ClockMode; dt: number }
  | { type: 'DIE_ROLLED'; roll: DieRoll }
  | { type: 'ORDER_ISSUED'; order: Order }
  | { type: 'ORDER_ACTIVATED'; orderId: Id; formationId: Id; tick: Tick }
  | { type: 'ORDER_COMPLETED'; orderId: Id; formationId: Id; tick: Tick }
  | { type: 'ORDER_SUPERSEDED'; orderId: Id; formationId: Id; tick: Tick }
  | { type: 'FORMATION_MOVED'; formationId: Id; to: GroundPos;
      movedKind: 'NORMAL' | 'CAUTIOUS' | 'FORCED' | 'SPRINT'; onRoad: boolean;
      headingDeg: number; tick: Tick }
  | { type: 'MOVE_PROGRESS'; formationId: Id; moveProgress: number; pathIndex: number }
  | { type: 'RDY_CHANGED'; formationId: Id; delta: number; reason: string }
  | { type: 'CONTACT_UPGRADED'; contact: Contact; tick: Tick }
  | { type: 'CONTACT_FADED'; contactId: Id; level: number; tick: Tick }
  | { type: 'CONTACT_REMOVED'; contactId: Id; tick: Tick }
  | { type: 'REPORT_QUEUED'; report: ContactReport }
  | { type: 'REPORT_DELIVERED'; reportId: Id; tick: Tick }
  | { type: 'REPORTS_LOST'; reportIds: Id[]; reason: string }
  | { type: 'NET_CHANGED'; formationId: Id; onNet: boolean;
      netNodeId: Id | null; renetAtTick: Tick | null }
  | { type: 'HEXES_SCOUTED'; sideId: Id; keys: string[] }
  | { type: 'SAT_PASS'; satelliteId: Id; tick: Tick; nextPassTick: Tick }
  | { type: 'FORMATION_DESTROYED'; formationId: Id; reason: string; tick: Tick }
  | { type: 'GM_NOTE'; text: string; tick: Tick }
  // ── M2: triggers, engagement, handoff round-trip, logistics ──
  | { type: 'TRIGGER_FIRED'; orderId: Id; formationId: Id; triggerIndex: number;
      newOrder: Order; tick: Tick }
  | { type: 'POSTURE_CHANGED'; formationId: Id; posture: Posture; tick: Tick }
  | { type: 'ENGAGEMENT_TRIGGERED'; engagement: Engagement }
  | { type: 'EVASION_RESOLVED'; engagementId: Id; success: boolean;
      slipTo: GroundPos | null; tick: Tick }
  | { type: 'HANDOFF_EXPORTED'; engagementId: Id; pkg: HandoffPackage; tick: Tick }
  | { type: 'BATTLE_RESULT_INGESTED'; engagementId: Id; handoffId: Id; tick: Tick }
  | { type: 'UNIT_STATE_CHANGED'; unitId: Id; damage: DamageState; ammoState: string;
      fpRemaining?: number /* M3: tabletop fuel comes home on the record sheet */ }
  | { type: 'PILOT_STATE_CHANGED'; pilotId: Id; status: Pilot['status'] }
  | { type: 'MARKER_ADDED'; marker: Marker }
  | { type: 'VP_CHANGED'; sideId: Id; delta: number; reason: string }
  | { type: 'ROUT_STARTED'; formationId: Id; untilTick: Tick; tick: Tick }
  | { type: 'SALVAGE_CREATED'; token: SalvageToken }
  | { type: 'SALVAGE_RESOLVED'; tokenId: Id; outcome: 'UNIT' | 'PARTS'; tick: Tick }
  | { type: 'SUPPLY_CHANGED'; formationId: Id; inSupply: boolean; lastSuppliedTick: Tick }
  // ── replay-safe engine bookkeeping (fractional accumulators, anchors) ──
  | { type: 'FORMATION_BOOKKEEPING'; formationId: Id;
      patch: Partial<Pick<Formation, 'forcedMarchPulseAcc' | 'digInPulseAcc'>> &
             { air?: Partial<NonNullable<Formation['air']>> } }
  // ── M3: SKYWATCH — flights, ledgers, alerts, turnaround ──
  | { type: 'FORMATION_SPAWNED'; formation: Formation; units: Unit[];
      pilots: Pilot[]; tick: Tick }
  | { type: 'ALERT_CHANGED'; formationId: Id; alertState: NonNullable<Formation['alertState']>;
      tick: Tick }
  | { type: 'AIR_LAUNCHED'; formationId: Id; pos: AirPos; fpPaid: number; tick: Tick }
  | { type: 'AIR_MOVED'; formationId: Id; pos: AirPos; fpPaid: number;
      speed: 'CRUISE' | 'DASH'; tick: Tick }
  | { type: 'AIR_PHASE'; formationId: Id; phase: NonNullable<Formation['air']>['phase'];
      tick: Tick }
  | { type: 'AIR_LANDED'; formationId: Id; facilityId: Id; pos: GroundPos;
      fpPaid: number; tick: Tick }
  | { type: 'FUEL_SPENT'; formationId: Id; fpPaid: number; reason: string; tick: Tick }
  | { type: 'FUEL_THRESHOLD'; formationId: Id; threshold: 'JOKER' | 'BINGO';
      fpMin: number; tick: Tick }
  | { type: 'PILOT_FATIGUE'; pilotId: Id; delta: number }
  | { type: 'TURNAROUND_STARTED'; formationId: Id; facilityId: Id;
      mode: 'STANDARD' | 'HOT_PIT'; readyTick: Tick; tonsDrawn: number;
      mishapFarmFpLoss?: number; tick: Tick }
  | { type: 'CLOCK_ADVANCED'; dt: number; tick: Tick }; // tick = NEW absolute tick

export interface LoggedEvent { index: number; event: GameEvent }

/** Mutates `s` in place. Callers own the state object (replay folds into a fresh clone). */
export function applyEvent(s: TruthState, e: GameEvent): void {
  switch (e.type) {
    case 'CAMPAIGN_INIT':
      // genesis: handled by replay() — state snapshot becomes the initial truth
      break;

    case 'STEP_BEGAN':
      s.clockMode = e.mode;
      for (const f of Object.values(s.formations)) {
        f.transient = { moved: 'NONE', onRoad: false, fired: false };
      }
      break;

    case 'DIE_ROLLED':
      s.seedCursor = e.roll.seedCursor + (e.roll.dice === '2d6' ? 2 : 1);
      break;

    case 'ORDER_ISSUED':
      s.orders[e.order.id] = e.order;
      break;

    case 'ORDER_ACTIVATED': {
      const f = s.formations[e.formationId];
      f.currentOrderId = e.orderId;
      f.pathIndex = 0;
      f.moveProgress = 0;
      const o = s.orders[e.orderId];
      if (o.kind === 'HIDE') f.posture = 'HIDE';
      else if (o.kind === 'DIG_IN') f.posture = 'DIGGING';
      else if (['MOVE', 'FORCED_MARCH', 'MOVE_CAUTIOUS', 'PATROL'].includes(o.kind)) {
        f.posture = 'NONE'; // breaking cover to move
      }
      // M3: a fresh air tasking puts an airborne flight back on mission (not RTB),
      // and resets the station clock
      if (f.pos.kind === 'air' && f.air) {
        f.air.phase = 'ENROUTE';
        f.air.loiterTicksRemaining = undefined;
      }
      if (o.emconOverride) f.emcon = o.emconOverride;
      break;
    }

    case 'ORDER_SUPERSEDED': {
      s.orders[e.orderId].completed = true;
      const f = s.formations[e.formationId];
      if (f.currentOrderId === e.orderId) f.currentOrderId = undefined;
      break;
    }

    case 'ORDER_COMPLETED': {
      s.orders[e.orderId].completed = true;
      const f = s.formations[e.formationId];
      if (f.currentOrderId === e.orderId) f.currentOrderId = undefined;
      break;
    }

    case 'FORMATION_MOVED': {
      const f = s.formations[e.formationId];
      f.pos = e.to;
      f.lastHeadingDeg = e.headingDeg;
      f.transient = {
        moved: e.movedKind, onRoad: e.onRoad,
        fired: f.transient?.fired ?? false,
      };
      break;
    }

    case 'MOVE_PROGRESS': {
      const f = s.formations[e.formationId];
      f.moveProgress = e.moveProgress;
      f.pathIndex = e.pathIndex;
      break;
    }

    case 'RDY_CHANGED': {
      const f = s.formations[e.formationId];
      f.rdy = Math.max(0, Math.min(10, f.rdy + e.delta));
      break;
    }

    case 'CONTACT_UPGRADED':
      s.contacts[e.contact.id] = e.contact;
      break;

    case 'CONTACT_FADED': {
      const c = s.contacts[e.contactId];
      c.level = e.level as Contact['level'];
      c.lastFadeTick = e.tick;
      break;
    }

    case 'CONTACT_REMOVED':
      delete s.contacts[e.contactId];
      break;

    case 'REPORT_QUEUED':
      s.reports[e.report.id] = e.report;
      break;

    case 'REPORT_DELIVERED': {
      const r = s.reports[e.reportId];
      r.deliveredTick = e.tick;
      const c = s.contacts[r.contactId];
      // merge into the side's received picture if newer than what they have (D-008.5)
      if (c && (!c.delivered || r.snapshot.asOfTick >= c.delivered.asOfTick)) {
        c.delivered = r.snapshot;
      }
      break;
    }

    case 'REPORTS_LOST':
      for (const id of e.reportIds) {
        const r = s.reports[id];
        if (r && r.deliveredTick === null) r.lost = true;
      }
      break;

    case 'NET_CHANGED': {
      const f = s.formations[e.formationId];
      f.onNet = e.onNet;
      f.netNodeId = e.netNodeId ?? undefined;
      f.renetAtTick = e.renetAtTick;
      break;
    }

    case 'HEXES_SCOUTED': {
      const set = new Set(s.scoutedHexes[e.sideId] ?? []);
      for (const k of e.keys) set.add(k);
      s.scoutedHexes[e.sideId] = [...set];
      break;
    }

    case 'SAT_PASS':
      s.satellites[e.satelliteId].nextPassTick = e.nextPassTick;
      break;

    case 'FORMATION_DESTROYED': {
      const f = s.formations[e.formationId];
      f.destroyed = true;
      f.currentOrderId = undefined;
      f.onNet = false;
      for (const side of Object.values(s.sides)) {
        side.commandNodes = side.commandNodes.filter(id => id !== e.formationId);
      }
      break;
    }

    case 'GM_NOTE':
      break;

    // ── M2 ──────────────────────────────────────────────────────────────────
    case 'TRIGGER_FIRED': {
      // record the spawned order; activation happens via the normal ORDER_ACTIVATED path
      s.orders[e.newOrder.id] = e.newOrder;
      // mark the conditional consumed so it cannot re-fire
      const order = s.orders[e.orderId];
      if (order?.conditionals?.[e.triggerIndex]) {
        (order.conditionals[e.triggerIndex] as { fired?: boolean }).fired = true;
      }
      break;
    }

    case 'POSTURE_CHANGED':
      s.formations[e.formationId].posture = e.posture;
      break;

    case 'ENGAGEMENT_TRIGGERED':
      s.engagements[e.engagement.id] = e.engagement;
      s.pendingEngagementId = e.engagement.id;
      break;

    case 'EVASION_RESOLVED': {
      const eng = s.engagements[e.engagementId];
      if (e.success) {
        eng.status = 'EVADED';
        s.pendingEngagementId = null;
      }
      // failure leaves the engagement PENDING for export
      break;
    }

    case 'HANDOFF_EXPORTED': {
      s.handoffs[e.pkg.id] = e.pkg;
      const eng = s.engagements[e.engagementId];
      eng.status = 'EXPORTED';
      eng.handoffId = e.pkg.id;
      break;
    }

    case 'BATTLE_RESULT_INGESTED': {
      const eng = s.engagements[e.engagementId];
      eng.status = 'RESOLVED';
      s.pendingEngagementId = null;
      for (const fid of [...eng.attackerFormationIds, ...eng.defenderFormationIds]) {
        const f = s.formations[fid];
        if (f && !f.destroyed) f.lastBattleTick = e.tick; // a fighting day ⇒ ×2 supply
      }
      break;
    }

    case 'UNIT_STATE_CHANGED': {
      const u = s.units[e.unitId];
      if (u) {
        u.damage = e.damage;
        u.ammoState = e.ammoState as typeof u.ammoState;
        if (e.fpRemaining !== undefined && u.fuel) u.fuel.fp = e.fpRemaining;
      }
      break;
    }

    case 'PILOT_STATE_CHANGED': {
      const p = s.pilots[e.pilotId];
      if (p) p.status = e.status;
      break;
    }

    case 'MARKER_ADDED':
      s.markers[e.marker.id] = e.marker;
      break;

    case 'VP_CHANGED':
      s.sides[e.sideId].vp += e.delta;
      break;

    case 'ROUT_STARTED': {
      const f = s.formations[e.formationId];
      f.routUntilTick = e.untilTick > 0 ? e.untilTick : null; // 0 ⇒ rout cleared
      break;
    }

    case 'SALVAGE_CREATED':
      s.salvage[e.token.id] = e.token;
      break;

    case 'SALVAGE_RESOLVED':
      delete s.salvage[e.tokenId];
      break;

    case 'SUPPLY_CHANGED': {
      const f = s.formations[e.formationId];
      f.supply = { inSupply: e.inSupply, lastSuppliedTick: e.lastSuppliedTick };
      break;
    }

    case 'FORMATION_BOOKKEEPING': {
      const f = s.formations[e.formationId];
      if (!f) break;
      const { air, ...rest } = e.patch;
      Object.assign(f, rest);
      if (air) f.air = { phase: 'GROUNDED', speed: 'CRUISE', ...f.air, ...air };
      break;
    }

    // ── M3: SKYWATCH ──────────────────────────────────────────────────────
    case 'FORMATION_SPAWNED': {
      for (const u of e.units) s.units[u.id] = u;
      for (const p of e.pilots) s.pilots[p.id] = p;
      s.formations[e.formation.id] = e.formation;
      break;
    }

    case 'ALERT_CHANGED': {
      const f = s.formations[e.formationId];
      f.alertState = e.alertState;
      f.air = { phase: 'GROUNDED', speed: 'CRUISE', ...f.air, alertAnchorTick: e.tick };
      break;
    }

    case 'AIR_LAUNCHED': {
      const f = s.formations[e.formationId];
      f.pos = e.pos;
      f.alertState = undefined; // airborne: the alert board no longer applies
      f.air = { speed: 'CRUISE', ...f.air, phase: 'ENROUTE', launchAtTick: null,
                lastLaunchTick: e.tick, jokerWarned: false, bingoCalled: false };
      for (const uid of f.unitIds) {
        const u = s.units[uid];
        if (u?.fuel) u.fuel.fp -= e.fpPaid;
      }
      break;
    }

    case 'AIR_MOVED': {
      const f = s.formations[e.formationId];
      f.pos = e.pos;
      for (const uid of f.unitIds) {
        const u = s.units[uid];
        if (u?.fuel) u.fuel.fp -= e.fpPaid;
      }
      break;
    }

    case 'AIR_PHASE': {
      const f = s.formations[e.formationId];
      f.air = { phase: e.phase, speed: 'CRUISE', ...f.air };
      f.air.phase = e.phase;
      break;
    }

    case 'AIR_LANDED': {
      const f = s.formations[e.formationId];
      f.pos = e.pos;
      f.air = { speed: 'CRUISE', ...f.air, phase: 'GROUNDED',
                homeFacilityId: f.air?.homeFacilityId ?? e.facilityId };
      for (const uid of f.unitIds) {
        const u = s.units[uid];
        if (u?.fuel) u.fuel.fp -= e.fpPaid;
      }
      break;
    }

    case 'FUEL_SPENT': {
      const f = s.formations[e.formationId];
      for (const uid of f.unitIds) {
        const u = s.units[uid];
        if (u?.fuel) u.fuel.fp = Math.max(0, u.fuel.fp - e.fpPaid);
      }
      break;
    }

    case 'FUEL_THRESHOLD': {
      const f = s.formations[e.formationId];
      f.air = { phase: 'ENROUTE', speed: 'CRUISE', ...f.air };
      if (e.threshold === 'JOKER') f.air.jokerWarned = true;
      else f.air.bingoCalled = true;
      break;
    }

    case 'PILOT_FATIGUE': {
      const p = s.pilots[e.pilotId];
      if (p) p.fatigue = Math.max(0, p.fatigue + e.delta);
      break;
    }

    case 'TURNAROUND_STARTED': {
      const f = s.formations[e.formationId];
      const fac = s.facilities[e.facilityId];
      fac.fuelFarmTons -= e.tonsDrawn + (e.mishapFarmFpLoss ?? 0) / SKYWATCH.FP_PER_TON;
      fac.turnaroundCrews.busyUntil.push(e.readyTick);
      f.air = { phase: 'GROUNDED', speed: 'CRUISE', ...f.air, turnaroundReadyTick: e.readyTick };
      for (const uid of f.unitIds) {
        const u = s.units[uid];
        if (u?.fuel) u.fuel.fp = Math.round(u.fuel.tons * u.fuel.fpPerTon);
        if (u) u.ammoState = 'FULL';
      }
      break;
    }

    case 'CLOCK_ADVANCED':
      s.tick = e.tick;
      break;
  }
}

/** Events that break clock compression: "something happened for someone" (spec §3.1). */
export function isInterestingEvent(e: GameEvent): boolean {
  switch (e.type) {
    case 'CONTACT_UPGRADED':
    case 'CONTACT_FADED':
    case 'CONTACT_REMOVED':
    case 'REPORT_DELIVERED':
    case 'ORDER_COMPLETED':
    case 'FORMATION_DESTROYED':
    case 'TRIGGER_FIRED':
    case 'ENGAGEMENT_TRIGGERED':
    case 'BATTLE_RESULT_INGESTED':
    case 'FUEL_THRESHOLD':
    case 'AIR_LAUNCHED':
    case 'AIR_LANDED':
    case 'FORMATION_SPAWNED':
      return true;
    default:
      return false;
  }
}
