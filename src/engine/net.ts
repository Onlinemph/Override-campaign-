/**
 * engine/net.ts — command nets & report delivery (core §4.2; spec §3.3).
 */
import { CLOCK, NET } from '../rules.js';
import type { Formation, GroundPos, Id, TruthState } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { hexDistance } from '../hex/axial.js';

export interface NetNode { id: Id; pos: GroundPos; radius: number; theaterWide: boolean }

export function commandNodesOf(s: TruthState, sideId: Id): NetNode[] {
  const out: NetNode[] = [];
  const side = s.sides[sideId];
  for (const nodeId of side.commandNodes) {
    const f = s.formations[nodeId];
    if (f && !f.destroyed && f.pos.kind === 'ground') {
      const isDropship = f.unitIds.some(uid => s.units[uid]?.class === 'DROPSHIP');
      out.push({ id: f.id, pos: f.pos,
                 radius: isDropship ? NET.DROPSHIP_BASE_RADIUS : NET.GROUND_NODE_RADIUS,
                 theaterWide: false });
    }
    const fac = s.facilities[nodeId];
    if (fac && fac.isCommandNode && fac.pos.kind === 'ground') {
      const big = fac.tags.includes('SPACEPORT') || fac.tags.includes('FORT');
      out.push({ id: fac.id, pos: fac.pos,
                 radius: big ? NET.DROPSHIP_BASE_RADIUS : NET.GROUND_NODE_RADIUS,
                 theaterWide: false });
    }
  }
  // live comm satellite ⇒ theater-wide relay (core §8.6)
  for (const sat of Object.values(s.satellites)) {
    if (sat.sideId === sideId && sat.kind === 'COMM' && sat.alive) {
      out.push({ id: sat.id, pos: { kind: 'ground', theaterId: sat.theaterId, q: 0, r: 0 },
                 radius: Infinity, theaterWide: true });
    }
  }
  return out;
}

function inHostileEcmBubble(s: TruthState, f: Formation): boolean {
  if (f.pos.kind !== 'ground') return false;
  for (const other of Object.values(s.formations)) {
    if (other.destroyed || other.sideId === f.sideId || other.pos.kind !== 'ground') continue;
    if (other.pos.theaterId !== f.pos.theaterId) continue;
    const hasEcm = other.unitIds.some(uid =>
      s.units[uid]?.tags.includes('ECM') || s.units[uid]?.tags.includes('ANGEL_ECM'));
    if (hasEcm && hexDistance(other.pos, f.pos) <= NET.ECM_NET_CUT_RADIUS) return true;
  }
  return false;
}

/** Which node (if any) could net this formation right now? */
export function reachableNode(s: TruthState, f: Formation): NetNode | null {
  if (f.pos.kind !== 'ground') return null;
  for (const node of commandNodesOf(s, f.sideId)) {
    if (node.theaterWide && node.pos.theaterId === f.pos.theaterId) return node;
    if (!node.theaterWide && node.pos.theaterId === f.pos.theaterId &&
        hexDistance(node.pos, f.pos) <= node.radius) return node;
  }
  return null;
}

/** Instantaneous on-net check, including EMCON and ECM gates (core §4.2; spec §3.3). */
export function isFormationOnNet(s: TruthState, f: Formation): boolean {
  if (f.destroyed || f.emcon === 'DARK') return false;
  if (inHostileEcmBubble(s, f)) return false;
  return f.onNet; // state maintained by netPass; gates above can cut it instantly
}

/**
 * Recompute net membership and emit NET_CHANGED diffs.
 * Re-net costs 1 pulse only when the formation's previous node was lost (D-008.2).
 */
export function netPass(s: TruthState, emit: (e: GameEvent) => void): void {
  for (const f of Object.values(s.formations)) {
    if (f.destroyed) continue;

    const gateCut = f.emcon === 'DARK' || inHostileEcmBubble(s, f);
    const node = gateCut ? null : reachableNode(s, f);
    const prevNodeAlive = f.netNodeId !== undefined && (
      (s.formations[f.netNodeId] && !s.formations[f.netNodeId].destroyed) ||
      s.facilities[f.netNodeId] !== undefined ||
      (s.satellites[f.netNodeId]?.alive ?? false));

    if (node) {
      if (f.onNet && f.netNodeId === node.id) continue;
      if (f.renetAtTick != null) {
        // re-establishing command after losing a node (core §4.2: 1 pulse)
        if (s.tick >= f.renetAtTick) {
          emit({ type: 'NET_CHANGED', formationId: f.id, onNet: true,
                 netNodeId: node.id, renetAtTick: null });
        }
        continue;
      }
      if (f.netNodeId === node.id || prevNodeAlive || f.netNodeId === undefined) {
        // own node still valid (or first assignment): immediate (D-008.2)
        emit({ type: 'NET_CHANGED', formationId: f.id, onNet: true,
               netNodeId: node.id, renetAtTick: null });
      } else {
        emit({ type: 'NET_CHANGED', formationId: f.id, onNet: false, netNodeId: null,
               renetAtTick: s.tick + NET.RENET_PULSES * CLOCK.TICKS_PER_PULSE });
      }
    } else if (f.onNet) {
      emit({ type: 'NET_CHANGED', formationId: f.id, onNet: false,
             netNodeId: null, renetAtTick: null });
    }
  }
}

/**
 * Deliver held reports whose source is back on-net (core §4.2: off-net reports arrive
 * when the formation returns to net). Sources that died en route never deliver.
 */
export function deliverReportsPass(s: TruthState, emit: (e: GameEvent) => void): void {
  for (const r of Object.values(s.reports)) {
    if (r.deliveredTick !== null || r.lost) continue;
    const src = s.formations[r.sourceFormationId];
    if (!src) continue; // facility/satellite sources deliver at generation time
    if (src.destroyed) {
      emit({ type: 'REPORTS_LOST', reportIds: [r.id], reason: 'source destroyed' });
      continue;
    }
    if (isFormationOnNet(s, src)) {
      emit({ type: 'REPORT_DELIVERED', reportId: r.id, tick: s.tick });
    }
  }
}

/** Hexes currently inside a side's passive sensor envelopes become scouted terrain. */
export function scoutPass(s: TruthState, emit: (e: GameEvent) => void): void {
  for (const sideId of Object.keys(s.sides)) {
    const known = new Set(s.scoutedHexes[sideId] ?? []);
    const fresh: string[] = [];
    for (const f of Object.values(s.formations)) {
      if (f.destroyed || f.sideId !== sideId || f.pos.kind !== 'ground') continue;
      const range = Math.max(f.sns.passive, 2);
      const theater = s.theaters[f.pos.theaterId];
      if (!theater) continue;
      for (let dq = -range; dq <= range; dq++) {
        for (let dr = Math.max(-range, -dq - range); dr <= Math.min(range, -dq + range); dr++) {
          const q = f.pos.q + dq, r = f.pos.r + dr;
          if (!theater.hexes[`${q},${r}`]) continue;
          const key = `${f.pos.theaterId}:${q},${r}`;
          if (!known.has(key)) { known.add(key); fresh.push(key); }
        }
      }
    }
    if (fresh.length) emit({ type: 'HEXES_SCOUTED', sideId, keys: fresh });
  }
}
