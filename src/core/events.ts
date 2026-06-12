/**
 * core/events.ts — the append-only event vocabulary and the reducer.
 * Truth State is mutated ONLY by applyEvent (spec §0). The tick engine emits events;
 * it never touches state directly.
 */
import type {
  ClockMode, Contact, ContactReport, DieRoll, GroundPos, Id, Order, TruthState, Tick,
} from './types.js';

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
      return true;
    default:
      return false;
  }
}
