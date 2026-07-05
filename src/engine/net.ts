/**
 * engine/net.ts — command nets & report delivery (core §4.2; spec §3.3).
 *
 * D-048 — command relays: the net CHAINS. Any formation with an HQ-tagged unit
 * (a Mobile HQ, a command console) and any facility tagged COMM_RELAY is a relay
 * candidate; a relay is chained when it sits within NET.RELAY_LINK_HEXES of a
 * command node or another chained relay, and a chained relay nets formations at
 * the normal ground-node radius. The chain is recomputed from live positions
 * every pass — kill or jam a mid-chain relay and everything downstream goes dark.
 * A relaying formation is a big radio: SIG_MODS.RELAYING makes it easier to DF.
 */
import { CLOCK, NET } from '../rules.js';
import type { ContactReport, Facility, Formation, GroundPos, Id, TruthState } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { hexDistance } from '../hex/axial.js';

export interface NetNode {
  id: Id; pos: GroundPos; radius: number; theaterWide: boolean;
  relay?: boolean; // D-048: a chained relay, not a command node in its own right
}

export function commandNodesOf(s: TruthState, sideId: Id): NetNode[] {
  const groundR = s.config.netGroundRadius ?? NET.GROUND_NODE_RADIUS;
  const baseR = s.config.netBaseRadius ?? NET.DROPSHIP_BASE_RADIUS;
  const out: NetNode[] = [];
  const side = s.sides[sideId];
  for (const nodeId of side.commandNodes) {
    const f = s.formations[nodeId];
    if (f && !f.destroyed && f.pos.kind === 'ground') {
      const isDropship = f.unitIds.some(uid => s.units[uid]?.class === 'DROPSHIP');
      out.push({ id: f.id, pos: f.pos, radius: isDropship ? baseR : groundR, theaterWide: false });
    }
    const fac = s.facilities[nodeId];
    if (fac && fac.isCommandNode && fac.pos.kind === 'ground' &&
        fac.damage !== 'DESTROYED') { // D-052: a flattened HQ commands nothing
      const big = fac.tags.includes('SPACEPORT') || fac.tags.includes('FORT');
      out.push({ id: fac.id, pos: fac.pos, radius: big ? baseR : groundR, theaterWide: false });
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

/** Relay candidates for a side: HQ-carrying formations + COMM_RELAY facilities. */
function relayCandidates(s: TruthState, sideId: Id): NetNode[] {
  const out: NetNode[] = [];
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.sideId !== sideId || f.pos.kind !== 'ground' || f.mounted) continue;
    if (f.emcon === 'DARK') continue; // radio off relays nothing
    if (inHostileEcmBubble(s, f)) continue; // a jammed relay drops out of the chain
    if (!f.unitIds.some(uid => s.units[uid]?.tags.includes('HQ'))) continue;
    out.push({ id: f.id, pos: f.pos, radius: NET.GROUND_NODE_RADIUS,
               theaterWide: false, relay: true });
  }
  for (const fac of Object.values(s.facilities)) {
    if (fac.sideId !== sideId || fac.pos.kind !== 'ground') continue;
    if (!fac.tags.includes('COMM_RELAY')) continue;
    if (fac.damage === 'DESTROYED') continue; // D-052: a downed mast relays nothing
    out.push({ id: fac.id, pos: fac.pos, radius: NET.GROUND_NODE_RADIUS,
               theaterWide: false, relay: true });
  }
  return out;
}

/**
 * Command nodes PLUS every relay chained back to them (D-048). Chaining is a
 * BFS over link range: a relay joins when within NET.RELAY_LINK_HEXES of a node
 * or an already-chained relay in the same theater (a theater-wide comm sat
 * chains every candidate in its theater — the sky is the backbone).
 */
export function netNodesOf(s: TruthState, sideId: Id): NetNode[] {
  const anchors = commandNodesOf(s, sideId);
  const anchorIds = new Set(anchors.map(a => a.id));
  // a command node that also carries an HQ unit is already an anchor, not a relay
  const pending = relayCandidates(s, sideId).filter(c => !anchorIds.has(c.id));
  const chained: NetNode[] = [];
  let frontier: NetNode[] = anchors;
  while (frontier.length && pending.length) {
    const next: NetNode[] = [];
    for (let i = pending.length - 1; i >= 0; i--) {
      const cand = pending[i];
      const linked = frontier.some(a =>
        a.pos.theaterId === cand.pos.theaterId &&
        (a.theaterWide || hexDistance(a.pos, cand.pos) <= NET.RELAY_LINK_HEXES));
      if (linked) {
        pending.splice(i, 1);
        chained.push(cand);
        next.push(cand);
      }
    }
    frontier = next;
  }
  return [...anchors, ...chained];
}

/** Is this formation currently a CHAINED relay (for the detection SIG penalty)? */
export function isChainRelay(s: TruthState, f: Formation): boolean {
  if (f.destroyed || f.pos.kind !== 'ground' || f.mounted || f.emcon === 'DARK') return false;
  if (!f.unitIds.some(uid => s.units[uid]?.tags.includes('HQ'))) return false;
  return netNodesOf(s, f.sideId).some(n => n.relay && n.id === f.id);
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

/** Which node or chained relay (if any) could net this formation right now? */
export function reachableNode(s: TruthState, f: Formation, nodes?: NetNode[]): NetNode | null {
  if (f.pos.kind !== 'ground') return null;
  for (const node of nodes ?? netNodesOf(s, f.sideId)) {
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
  const nodesBySide = new Map<Id, NetNode[]>(); // chains computed once per side
  for (const f of Object.values(s.formations)) {
    if (f.destroyed) continue;

    let nodes = nodesBySide.get(f.sideId);
    if (!nodes) nodesBySide.set(f.sideId, nodes = netNodesOf(s, f.sideId));
    const gateCut = f.emcon === 'DARK' || inHostileEcmBubble(s, f);
    const node = gateCut ? null : reachableNode(s, f, nodes);
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
/**
 * D-051.1: log an enemy installation. Buildings don't move, so a spot is permanent —
 * but the KNOWLEDGE still has to travel: the sighting rides the normal report
 * pipeline. An on-net source develops the film immediately (FACILITY_SPOTTED); an
 * off-net one (a recon flight, a deep scout) carries it home, and if the source dies
 * first the photo is lost with it. One report per (facility, side, source): the
 * first courier to make it back is the one that matters.
 */
export function spotFacility(
  s: TruthState, emit: (e: GameEvent) => void,
  sideId: Id, fac: Facility, source: { id: Id; name: string; alwaysOnNet: boolean },
): void {
  if (fac.sideId === sideId || fac.pos.kind !== 'ground') return;
  if ((fac.knownTo ?? []).includes(sideId)) return;
  if (Object.values(s.reports).some(r =>
    r.sideId === sideId && r.facilityId === fac.id &&
    r.sourceFormationId === source.id && !r.lost)) return; // this source already filed

  let n = 0;
  while (s.reports[`report:${s.tick}:fac:${fac.id}:${sideId}:${n}`]) n++;
  const pos = fac.pos;
  const kind = fac.capitalBattery ? `capital battery [${fac.capitalBattery.weapon}]`
    : fac.tags.length ? fac.tags.join('/') : 'installation';
  const report: ContactReport = {
    id: `report:${s.tick}:fac:${fac.id}:${sideId}:${n}`,
    sideId, generatedTick: s.tick, deliveredTick: null,
    sourceFormationId: source.id, contactId: '', facilityId: fac.id,
    text: `T+${s.tick} — ${source.name}: enemy ${kind} "${fac.name}" at hex ${pos.q},${pos.r}`,
    snapshot: { level: 4, estPos: { ...pos }, posErrorHexes: 0, asOfTick: s.tick },
  };
  emit({ type: 'REPORT_QUEUED', report });
  const onNet = source.alwaysOnNet ||
    (s.formations[source.id] ? isFormationOnNet(s, s.formations[source.id]) : false);
  if (onNet) {
    emit({ type: 'REPORT_DELIVERED', reportId: report.id, tick: s.tick });
    emit({ type: 'FACILITY_SPOTTED', facilityId: fac.id, sideId, tick: s.tick });
  }
}

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
      // D-051.1: a facility photo develops the moment its courier reaches the net
      if (r.facilityId && s.facilities[r.facilityId] &&
          !(s.facilities[r.facilityId].knownTo ?? []).includes(r.sideId)) {
        emit({ type: 'FACILITY_SPOTTED', facilityId: r.facilityId,
               sideId: r.sideId, tick: s.tick });
      }
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
      // D-051.1: eyes that scout the ground also log the base sitting on it
      for (const fac of Object.values(s.facilities)) {
        if (fac.sideId === sideId || fac.pos.kind !== 'ground') continue;
        if (fac.pos.theaterId !== f.pos.theaterId) continue;
        if (hexDistance(fac.pos, f.pos) > range) continue;
        spotFacility(s, emit, sideId, fac, { id: f.id, name: f.name, alwaysOnNet: false });
      }
    }
    if (fresh.length) emit({ type: 'HEXES_SCOUTED', sideId, keys: fresh });
  }
}
