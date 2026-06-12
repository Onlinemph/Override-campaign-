/**
 * engine/engagement.ts — battle triggering (core §7.1; spec §3.1).
 *
 * Detects when counters must go to the tabletop: same op-hex, a SCREEN intercept, or a
 * STRIKE reaching its target. The engine NEVER simulates the fight — it emits one
 * ENGAGEMENT_TRIGGERED, which freezes the campaign (`pendingEngagementId`) until the GM
 * exports a handoff and ingests a result. Only one engagement is pending at a time;
 * detection is deterministic (hexes and ids sorted).
 */
import type { Engagement, Formation, GroundPos, Id, TruthState } from '../core/types.js';
import { hexKey } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { hexDistance } from '../hex/axial.js';
import { strikeTargetHex } from './movement.js';
import { airEngagementCandidates } from './air.js';

function asHex(f: Formation): GroundPos | null {
  return f.pos.kind === 'ground' ? f.pos : null;
}

/** Best ladder level `sideId` holds on `formationId` (intel that drives who is attacker). */
function ladderHeldBy(s: TruthState, sideId: Id, formationId: Id): number {
  let best = 0;
  for (const c of Object.values(s.contacts)) {
    if (c.observerSideId === sideId && c.targetFormationId === formationId) {
      best = Math.max(best, c.level);
    }
  }
  return best;
}

function maxLadderBetween(s: TruthState, sideId: Id, enemyFormationIds: Id[]): number {
  return Math.max(0, ...enemyFormationIds.map(id => ladderHeldBy(s, sideId, id)));
}

function buildEngagement(
  s: TruthState, hex: GroundPos, trigger: Engagement['trigger'],
  attackerSideId: Id, defenderSideId: Id,
): Engagement {
  const here = (f: Formation) => {
    const h = asHex(f);
    return h && h.theaterId === hex.theaterId && h.q === hex.q && h.r === hex.r;
  };
  const attackerFormationIds = Object.values(s.formations)
    .filter(f => !f.destroyed && f.sideId === attackerSideId && here(f))
    .map(f => f.id).sort();
  const defenderFormationIds = Object.values(s.formations)
    .filter(f => !f.destroyed && f.sideId === defenderSideId && here(f))
    .map(f => f.id).sort();
  return {
    id: `eng:${s.tick}:${hexKey(hex.q, hex.r)}:${attackerSideId}-${defenderSideId}`,
    tick: s.tick, hex: { ...hex }, trigger,
    attackerSideId, defenderSideId, attackerFormationIds, defenderFormationIds,
    status: 'PENDING',
  };
}

export function engagementPass(s: TruthState, emit: (e: GameEvent) => void): void {
  if (s.pendingEngagementId) return; // already frozen awaiting GM

  const live = Object.values(s.formations).filter(f => !f.destroyed && asHex(f));

  // STRIKE arrival on a stale estimate (no enemy present): the strike completes with a
  // miss rather than starting a battle. (When the enemy IS present, the same-hex/STRIKE
  // detection below fires instead and the order stays active for the battle.)
  for (const f of live) {
    const o = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;
    if (!o || o.completed || o.kind !== 'STRIKE') continue;
    const target = strikeTargetHex(s, o);
    const here = asHex(f)!;
    const arrived = target && hexDistance(here, target) === 0;
    if (!arrived) continue;
    const enemyHere = live.some(g => g.sideId !== f.sideId &&
      asHex(g)!.theaterId === here.theaterId && asHex(g)!.q === here.q && asHex(g)!.r === here.r);
    if (!enemyHere) {
      emit({ type: 'ORDER_COMPLETED', orderId: o.id, formationId: f.id, tick: s.tick });
    }
  }

  // group formations by hex
  const byHex = new Map<string, Formation[]>();
  for (const f of live) {
    const h = asHex(f)!;
    const key = `${h.theaterId}:${hexKey(h.q, h.r)}`;
    (byHex.get(key) ?? byHex.set(key, []).get(key)!).push(f);
  }

  // candidate engagements; we fire the first in deterministic order
  const candidates: Engagement[] = [];

  for (const [, fs] of [...byHex.entries()].sort()) {
    const sides = [...new Set(fs.map(f => f.sideId))].sort();
    if (sides.length < 2) continue;
    const [a, b] = sides;
    const hex = asHex(fs[0])!;

    // STRIKE: a striker whose true target shares its hex (core §7.1c)
    const striker = fs.find(f => {
      const o = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;
      return o && !o.completed && o.kind === 'STRIKE';
    });

    // SAME_HEX requires a fresh arrival this step (avoids re-triggering post-battle, D-009)
    const someoneMoved = fs.some(f => f.transient && f.transient.moved !== 'NONE');
    if (!striker && !someoneMoved) continue;

    let attackerSide: Id, defenderSide: Id, trigger: Engagement['trigger'];
    if (striker) {
      attackerSide = striker.sideId;
      defenderSide = striker.sideId === a ? b : a;
      trigger = 'STRIKE';
    } else {
      // attacker = side with the better intel on the other (it sought this); tie → mover
      const aAdv = maxLadderBetween(s, a, fs.filter(f => f.sideId === b).map(f => f.id));
      const bAdv = maxLadderBetween(s, b, fs.filter(f => f.sideId === a).map(f => f.id));
      if (aAdv !== bAdv) {
        attackerSide = aAdv > bAdv ? a : b;
      } else {
        const aMoved = fs.some(f => f.sideId === a && f.transient?.moved !== 'NONE');
        attackerSide = aMoved ? a : b;
      }
      defenderSide = attackerSide === a ? b : a;
      trigger = 'SAME_HEX';
    }
    candidates.push(buildEngagement(s, hex, trigger, attackerSide, defenderSide));
  }

  // SCREEN: a screening formation intercepts an enemy that entered a hex it screens
  for (const screener of live) {
    const o = screener.currentOrderId ? s.orders[screener.currentOrderId] : undefined;
    if (!o || o.completed || o.kind !== 'SCREEN') continue;
    const screened = screenedHexes(s, screener);
    for (const mover of live) {
      if (mover.sideId === screener.sideId) continue;
      if (!mover.transient || mover.transient.moved === 'NONE') continue;
      const mh = asHex(mover)!;
      if (!screened.some(h => h.theaterId === mh.theaterId && h.q === mh.q && h.r === mh.r)) continue;
      // battle is fought in the mover's hex; screener is the defender holding the line
      candidates.push(buildEngagement(s, mh, 'SCREEN', mover.sideId, screener.sideId));
    }
  }

  // AIR_INTERCEPT (M3, SKYWATCH §6): pursuer in the target's air hex with ≥SHADOW + intent
  for (const { pursuer, target, pos } of airEngagementCandidates(s)) {
    candidates.push({
      id: `eng:${s.tick}:air:${pos.gridQ},${pos.gridR}:${pursuer.sideId}-${target.sideId}`,
      tick: s.tick, trigger: 'AIR_INTERCEPT', domain: 'AIR', airPos: structuredClone(pos),
      attackerSideId: pursuer.sideId, defenderSideId: target.sideId,
      attackerFormationIds: [pursuer.id], defenderFormationIds: [target.id],
      status: 'PENDING',
    });
  }

  if (candidates.length === 0) return;
  candidates.sort((x, y) => x.id.localeCompare(y.id));
  emit({ type: 'ENGAGEMENT_TRIGGERED', engagement: candidates[0] });
}

/** Hexes a SCREEN order covers: its own hex plus any listed path hexes (the screen line). */
export function screenedHexes(s: TruthState, screener: Formation): GroundPos[] {
  const out: GroundPos[] = [];
  const h = asHex(screener);
  if (h) out.push(h);
  const o = screener.currentOrderId ? s.orders[screener.currentOrderId] : undefined;
  for (const p of o?.path ?? []) if (p.kind === 'ground') out.push(p);
  return out;
}
