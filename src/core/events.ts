/**
 * core/events.ts — the append-only event vocabulary and the reducer.
 * Truth State is mutated ONLY by applyEvent (spec §0). The tick engine emits events;
 * it never touches state directly.
 */
import type {
  AirPos, ClockMode, Contact, ContactReport, DamageState, DieRoll, Emcon, Emission,
  Engagement, Formation, GroundPos, HandoffPackage, Id, JumpDrive, LanePos, Marker,
  NodePos, Order, Pilot, Position, Posture, RefitProject, SalvageToken, TruthState,
  Tick, Unit,
} from './types.js';
import { CAREER, SKYWATCH } from '../rules.js';
import { hexKey as hexKeyOf } from './types.js';

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
  | { type: 'REPORT_EDITED'; reportId: Id; text: string }   // M5: GM noise injection
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
  | { type: 'PILOT_STATE_CHANGED'; pilotId: Id; status: Pilot['status'];
      recoverAtTick?: Tick /* ext: WOUNDED heals to OK at this tick (careerPass) */ }
  // ── ext: the career loop — XP, repairs, refits ──
  | { type: 'PILOT_XP'; pilotId: Id; xpDelta: number; kills: number;
      reason: string; tick: Tick }
  | { type: 'REPAIR_STARTED'; unitId: Id; readyTick: Tick;
      facilityId?: Id; carrierId?: Id; tick: Tick }
  | { type: 'REPAIR_COMPLETED'; unitId: Id; tick: Tick }
  | { type: 'REFIT_QUEUED'; refit: RefitProject; tick: Tick }
  | { type: 'REFIT_STARTED'; refitId: Id; facilityId: Id; formationId: Id;
      readyTick: Tick; tick: Tick }
  | { type: 'REFIT_COMPLETED'; refitId: Id; unit: Unit; formationId: Id;
      pilot?: Pilot; tick: Tick }
  | { type: 'MARKER_ADDED'; marker: Marker }
  | { type: 'MARKER_REMOVED'; markerId: Id }
  | { type: 'FORMATION_FIRED'; formationId: Id; tick: Tick }      // M7: fired this turn (SIG −3)
  | { type: 'HEX_INFRA_CHANGED'; theaterId: Id; hexKey: string; infra: string[] }  // M7: demo/build
  | { type: 'SP_CHANGED'; facilityId: Id; delta: number; reason: string }          // M7: supply economy
  | { type: 'VP_CHANGED'; sideId: Id; delta: number; reason: string }
  | { type: 'ROUT_STARTED'; formationId: Id; untilTick: Tick; tick: Tick }
  | { type: 'SALVAGE_CREATED'; token: SalvageToken }
  | { type: 'SALVAGE_RESOLVED'; tokenId: Id; outcome: 'UNIT' | 'PARTS'; tick: Tick }
  | { type: 'SUPPLY_CHANGED'; formationId: Id; inSupply: boolean; lastSuppliedTick: Tick }
  // ── replay-safe engine bookkeeping (fractional accumulators, anchors) ──
  | { type: 'FORMATION_BOOKKEEPING'; formationId: Id;
      patch: Partial<Pick<Formation, 'forcedMarchPulseAcc' | 'digInPulseAcc' | 'engPulseAcc' | 'carriedSp'>> &
             { air?: Partial<NonNullable<Formation['air']>>;
               space?: Partial<NonNullable<Formation['space']>> } }
  // ── M3: SKYWATCH — flights, ledgers, alerts, turnaround ──
  | { type: 'FORMATION_SPAWNED'; formation: Formation; units: Unit[];
      pilots: Pilot[]; jumpDrives?: JumpDrive[]; tick: Tick }
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
  | { type: 'CARRIER_TURNAROUND_STARTED'; carrierId: Id; formationId: Id;
      readyTick: Tick; tonsDrawn: number; tick: Tick } // ext: rearm from a DropShip
  // ── M4: DEEP SKY — lanes, light, fuel tonnage, the jump board ──
  | { type: 'LANE_PROGRESS'; formationId: Id; pos: LanePos; tick: Tick }
  | { type: 'ARRIVED_AT_NODE'; formationId: Id; pos: NodePos; tick: Tick }
  | { type: 'TONS_BURNED'; formationId: Id; tons: number; reason: string; tick: Tick }
  | { type: 'TONS_GAINED'; formationId: Id; tons: number; reason: string; tick: Tick }
  | { type: 'EMISSION_CREATED'; emission: Emission }
  | { type: 'EMISSION_OBSERVED'; emissionId: Id; sideId: Id; tick: Tick }
  | { type: 'EMCON_CHANGED'; formationId: Id; emcon: Emcon; tick: Tick }
  | { type: 'SPACE_SWEEP'; tick: Tick }                 // watch-cadence anchor
  | { type: 'JUMP_CHARGE'; unitId: Id; chargePct: number }
  | { type: 'SAIL_CHANGED'; unitId: Id; sail: JumpDrive['sail']; tick: Tick }
  | { type: 'KF_DAMAGE'; unitId: Id; kfDamage: JumpDrive['kfDamage']; tick: Tick }
  | { type: 'JUMP_EXECUTED'; formationId: Id; toNodeId: Id; usedLfBattery: boolean;
      tick: Tick }
  | { type: 'MISJUMP'; formationId: Id; targetNodeId: Id; roll: number; tick: Tick }
  | { type: 'NODE_SURVEYED'; nodeId: Id; sideId: Id; tick: Tick }
  | { type: 'REPRISAL_OWED'; sideId: Id; reason: string; tick: Tick }
  // ── M6: VP scoring & endings (core §12) ──
  | { type: 'OBJECTIVE_CONTROL'; theaterId: Id; hexKey: string; ownerSideId: Id; tick: Tick }
  | { type: 'NODE_CONTROL'; nodeId: Id; ownerSideId: Id; tick: Tick }
  | { type: 'DAY_SCORED'; tick: Tick }            // advances the daily-accrual anchor
  | { type: 'CAMPAIGN_ENDED'; winnerSideId: Id | null; reason: string; tick: Tick }
  // ── M8: combined-arms kit ──
  | { type: 'MOUNT_CHANGED'; formationId: Id; carrierFormationId: Id | null }
  | { type: 'MOUNT_MOVED'; formationId: Id; pos: Position; tick: Tick } // embarked unit rides its carrier
  | { type: 'TRANSPONDER_REVEALED'; formationId: Id; tick: Tick }   // false flag blown
  | { type: 'BLOCKADE_STATE'; sideId: Id; blockaded: boolean; tick: Tick }
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

    case 'REPORT_EDITED': {
      const r = s.reports[e.reportId];
      if (r) r.text = e.text; // the GM is the radio static (core §13.1)
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
        if (e.fpRemaining !== undefined && u.fuel) {
          u.fuel.fp = e.fpRemaining;
          // strategic-ledger hulls (DEEP SKY §3): tabletop FP converts back to tonnage
          if (u.fuel.tonsPerBurnDay !== undefined && u.fuel.fpPerTon > 0) {
            u.fuel.tons = e.fpRemaining / u.fuel.fpPerTon;
          }
        }
      }
      break;
    }

    case 'PILOT_STATE_CHANGED': {
      const p = s.pilots[e.pilotId];
      if (p) {
        p.status = e.status;
        if (e.recoverAtTick !== undefined) p.recoverAtTick = e.recoverAtTick;
        else if (e.status === 'OK') delete p.recoverAtTick; // healed / released
      }
      break;
    }

    case 'PILOT_XP': {
      const p = s.pilots[e.pilotId];
      if (!p) break;
      const before = p.xp ?? 0;
      p.xp = before + e.xpDelta;
      p.kills += e.kills;
      if (p.kills >= CAREER.ACE_KILLS) p.ace = true;
      // skill growth: each XP_PER_IMPROVEMENT crossed improves the weaker skill
      // (gunnery on a tie), respecting the floors — deterministic, so replay-safe
      const crossings = Math.floor(p.xp / CAREER.XP_PER_IMPROVEMENT)
                      - Math.floor(before / CAREER.XP_PER_IMPROVEMENT);
      for (let i = 0; i < crossings; i++) {
        const canGun = p.gunnery > CAREER.GUNNERY_FLOOR;
        const canPil = p.piloting > CAREER.PILOTING_FLOOR;
        if (canGun && (p.gunnery >= p.piloting || !canPil)) p.gunnery -= 1;
        else if (canPil) p.piloting -= 1;
      }
      break;
    }

    case 'REPAIR_STARTED': {
      const u = s.units[e.unitId];
      if (u) u.repairReadyTick = e.readyTick;
      if (e.carrierId) {
        const c = s.formations[e.carrierId];
        if (c?.carrier) (c.carrier.crewBusyUntil ??= []).push(e.readyTick);
      }
      break;
    }

    case 'REPAIR_COMPLETED': {
      const u = s.units[e.unitId];
      if (u) {
        u.damage = 'OK';
        delete u.repairReadyTick;
      }
      break;
    }

    case 'REFIT_QUEUED':
      (s.refits ??= {})[e.refit.id] = e.refit;
      break;

    case 'REFIT_STARTED': {
      const r = s.refits?.[e.refitId];
      if (r) {
        r.status = 'IN_PROGRESS';
        r.facilityId = e.facilityId;
        r.formationId = e.formationId;
        r.readyTick = e.readyTick;
      }
      break;
    }

    case 'REFIT_COMPLETED': {
      const f = s.formations[e.formationId];
      s.units[e.unit.id] = structuredClone(e.unit);
      if (e.pilot) {
        s.pilots[e.pilot.id] = structuredClone(e.pilot);
        s.units[e.unit.id].pilotIds = [e.pilot.id];
      }
      if (f && !f.unitIds.includes(e.unit.id)) f.unitIds.push(e.unit.id);
      if (s.refits) delete s.refits[e.refitId];
      break;
    }

    case 'MARKER_ADDED':
      s.markers[e.marker.id] = e.marker;
      // a minefield is registered on its hex so movers can hit it (core §9.3)
      if (e.marker.kind === 'MINEFIELD' && e.marker.pos.kind === 'ground') {
        const hex = s.theaters[e.marker.pos.theaterId]?.hexes[hexKeyOf(e.marker.pos.q, e.marker.pos.r)];
        if (hex && !hex.minefieldIds.includes(e.marker.id)) hex.minefieldIds.push(e.marker.id);
      }
      break;

    case 'MARKER_REMOVED': {
      const m = s.markers[e.markerId];
      if (m && m.kind === 'MINEFIELD' && m.pos.kind === 'ground') {
        const hex = s.theaters[m.pos.theaterId]?.hexes[hexKeyOf(m.pos.q, m.pos.r)];
        if (hex) hex.minefieldIds = hex.minefieldIds.filter(id => id !== e.markerId);
      }
      delete s.markers[e.markerId];
      break;
    }

    case 'FORMATION_FIRED': {
      const f = s.formations[e.formationId];
      if (f) f.transient = { moved: f.transient?.moved ?? 'NONE',
        onRoad: f.transient?.onRoad ?? false, fired: true };
      break;
    }

    case 'HEX_INFRA_CHANGED': {
      const hex = s.theaters[e.theaterId]?.hexes[e.hexKey];
      if (hex) hex.infra = e.infra as typeof hex.infra;
      break;
    }

    case 'SP_CHANGED': {
      const fac = s.facilities[e.facilityId];
      if (fac) fac.supplyPoints = Math.max(0, fac.supplyPoints + e.delta);
      break;
    }

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
      const { air, space, ...rest } = e.patch;
      Object.assign(f, rest);
      if (air) f.air = { phase: 'GROUNDED', speed: 'CRUISE', ...f.air, ...air };
      if (space) f.space = { ...f.space, ...space };
      break;
    }

    // ── M3: SKYWATCH ──────────────────────────────────────────────────────
    case 'FORMATION_SPAWNED': {
      for (const u of e.units) s.units[u.id] = u;
      for (const p of e.pilots) s.pilots[p.id] = p;
      for (const d of e.jumpDrives ?? []) s.jumpDrives[d.vesselUnitId] = d;
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

    case 'CARRIER_TURNAROUND_STARTED': {
      const f = s.formations[e.formationId];
      const carrier = s.formations[e.carrierId];
      if (carrier?.carrier) {
        carrier.carrier.avFuelTons -= e.tonsDrawn;
        (carrier.carrier.crewBusyUntil ??= []).push(e.readyTick);
      }
      if (f) {
        f.air = { phase: 'GROUNDED', speed: 'CRUISE', ...f.air, turnaroundReadyTick: e.readyTick };
        for (const uid of f.unitIds) {
          const u = s.units[uid];
          if (u?.fuel) u.fuel.fp = Math.round(u.fuel.tons * u.fuel.fpPerTon);
          if (u) u.ammoState = 'FULL';
        }
      }
      break;
    }

    // ── M4: DEEP SKY ────────────────────────────────────────────────────────
    case 'LANE_PROGRESS':
      s.formations[e.formationId].pos = e.pos;
      break;

    case 'ARRIVED_AT_NODE':
      s.formations[e.formationId].pos = e.pos;
      break;

    case 'TONS_BURNED': {
      const f = s.formations[e.formationId];
      for (const uid of f.unitIds) {
        const u = s.units[uid];
        if (u?.fuel) u.fuel.tons = Math.max(0, u.fuel.tons - e.tons);
      }
      break;
    }

    case 'TONS_GAINED': {
      const f = s.formations[e.formationId];
      for (const uid of f.unitIds) {
        const u = s.units[uid];
        if (u?.fuel) u.fuel.tons += e.tons;
      }
      break;
    }

    case 'EMISSION_CREATED':
      s.emissions[e.emission.id] = e.emission;
      break;

    case 'EMISSION_OBSERVED': {
      const em = s.emissions[e.emissionId];
      if (em && !em.observedBy.includes(e.sideId)) em.observedBy.push(e.sideId);
      break;
    }

    case 'EMCON_CHANGED':
      s.formations[e.formationId].emcon = e.emcon;
      break;

    case 'SPACE_SWEEP':
      s.system.lastSweepTick = e.tick;
      break;

    case 'JUMP_CHARGE': {
      const d = s.jumpDrives[e.unitId];
      if (d) d.chargePct = Math.max(0, Math.min(100, e.chargePct));
      break;
    }

    case 'SAIL_CHANGED': {
      const d = s.jumpDrives[e.unitId];
      if (d) d.sail = e.sail;
      break;
    }

    case 'KF_DAMAGE': {
      const d = s.jumpDrives[e.unitId];
      if (d) d.kfDamage = e.kfDamage;
      break;
    }

    case 'JUMP_EXECUTED': {
      const f = s.formations[e.formationId];
      f.pos = { kind: 'node', nodeId: e.toNodeId };
      for (const uid of f.unitIds) {
        const d = s.jumpDrives[uid];
        if (!d) continue;
        if (e.usedLfBattery && d.lfBatteryCharged) d.lfBatteryCharged = false;
        else d.chargePct = 0;
      }
      break;
    }

    case 'MISJUMP':
      break; // placement & severity are the GM's misjump table; the log records the throw

    case 'NODE_SURVEYED': {
      const n = s.system.nodes[e.nodeId];
      if (n && !n.surveyedBy.includes(e.sideId)) n.surveyedBy.push(e.sideId);
      break;
    }

    case 'REPRISAL_OWED':
      s.sides[e.sideId].reprisalsOwed += 1;
      break;

    case 'OBJECTIVE_CONTROL': {
      const hex = s.theaters[e.theaterId]?.hexes[e.hexKey];
      if (hex?.objective) hex.objective.ownerSideId = e.ownerSideId;
      break;
    }

    case 'NODE_CONTROL': {
      const node = s.system.nodes[e.nodeId];
      if (node?.objective) node.objective.ownerSideId = e.ownerSideId;
      break;
    }

    case 'DAY_SCORED':
      s.lastScoredTick = e.tick;
      break;

    case 'CAMPAIGN_ENDED':
      s.ended = { winnerSideId: e.winnerSideId, reason: e.reason, tick: e.tick };
      break;

    case 'MOUNT_CHANGED': {
      const f = s.formations[e.formationId];
      if (f) {
        if (e.carrierFormationId) f.mounted = { carrierFormationId: e.carrierFormationId };
        else delete f.mounted;
      }
      break;
    }

    case 'MOUNT_MOVED': {
      const f = s.formations[e.formationId];
      if (f) f.pos = e.pos;
      break;
    }

    case 'TRANSPONDER_REVEALED': {
      const f = s.formations[e.formationId];
      if (f) f.squawk = undefined; // the lie is dropped once it's seen through
      break;
    }

    case 'BLOCKADE_STATE':
      break; // informational; the SP effect rides on SP_CHANGED in the same pass

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
    case 'ARRIVED_AT_NODE':
    case 'EMISSION_OBSERVED':
    case 'JUMP_EXECUTED':
    case 'MISJUMP':
    case 'OBJECTIVE_CONTROL':
    case 'NODE_CONTROL':
    case 'CAMPAIGN_ENDED':
    case 'UNIT_STATE_CHANGED':   // M7: arty/minefield damage is worth a look
    case 'TRANSPONDER_REVEALED': // M8: a false flag blown
    case 'REPAIR_COMPLETED':     // ext: a mech walks out of the shop
    case 'REFIT_COMPLETED':      // ext: a salvaged wreck joins the roster
      return true;
    default:
      return false;
  }
}
