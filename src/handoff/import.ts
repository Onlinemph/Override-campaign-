/**
 * handoff/import.ts — ingest a BattleResult back into truth (core §3.2, §6.4, §7.4, §7.5).
 *
 * Pure: produces the ordered GameEvent list that applies the tabletop outcome —
 * damage/ammo, pilots, ejection markers, RDY (−1, −2 if lost), mutual auto-LOCK,
 * salvage for the hex-controller, formation destruction, withdrawal displacement, and
 * rout for broken formations. The final BATTLE_RESULT_INGESTED unfreezes the campaign.
 */
import { CLOCK, ENGAGEMENT, LADDER, RDY } from '../rules.js';
import type {
  BattleResult, Contact, ContactSnapshot, Engagement, GroundPos, Id, LadderLevel,
  Marker, TruthState,
} from '../core/types.js';
import type { GameEvent } from '../core/events.js';

const WITHDRAW_DELTA: Record<string, { q: number; r: number }> = {
  E: { q: 1, r: 0 }, NE: { q: 1, r: -1 }, N: { q: 0, r: -1 }, NW: { q: -1, r: 0 },
  W: { q: -1, r: 0 }, SW: { q: -1, r: 1 }, S: { q: 0, r: 1 }, SE: { q: 0, r: 1 },
};

function lockSnapshot(s: TruthState, targetFormationId: Id): ContactSnapshot {
  const f = s.formations[targetFormationId];
  const pos = f.pos as GroundPos;
  return {
    level: 4, estPos: { ...pos }, posErrorHexes: 0,
    estVector: f.lastHeadingDeg, estSizeClass: undefined,
    estComposition: undefined,
    toe: f.unitIds.map(uid => {
      const u = s.units[uid];
      return { name: u.name, model: u.model, damage: u.damage,
               ammoState: u.ammoState, emcon: f.emcon };
    }),
    asOfTick: s.tick,
  };
}

function lockContact(s: TruthState, observerSideId: Id, target: Id): Contact {
  const snap = lockSnapshot(s, target);
  return {
    id: `contact:${observerSideId}:${target}`, observerSideId, targetFormationId: target,
    kind: 'STANDARD', level: 4 as LadderLevel,
    lastConfirmedTick: s.tick, lastFadeTick: s.tick,
    estPos: snap.estPos, posErrorHexes: 0,
    estVector: snap.estVector, staleAsOfTick: s.tick, delivered: snap,
  };
}

export function ingestBattleResult(
  s: TruthState, eng: Engagement, result: BattleResult,
): GameEvent[] {
  const events: GameEvent[] = [];
  const allFormationIds = [...eng.attackerFormationIds, ...eng.defenderFormationIds];

  // 1. unit damage / ammo
  for (const o of result.unitOutcomes) {
    if (!s.units[o.unitId]) continue;
    events.push({ type: 'UNIT_STATE_CHANGED', unitId: o.unitId,
                  damage: o.damage, ammoState: o.ammoState });
  }
  // 2. pilots
  for (const o of result.unitOutcomes) {
    for (const p of o.pilotOutcomes) {
      if (s.pilots[p.pilotId]) {
        events.push({ type: 'PILOT_STATE_CHANGED', pilotId: p.pilotId, status: p.status });
      }
    }
  }
  // 3. ejections → DOWNED_CREW markers (SKYWATCH §8.4 / core §10.4)
  for (const ej of result.ejections) {
    const marker: Marker = {
      id: `marker:downed:${ej.pilotId}:${s.tick}`, kind: 'DOWNED_CREW',
      pos: ej.pos, payload: { pilotId: ej.pilotId }, beaconActive: true,
    };
    events.push({ type: 'MARKER_ADDED', marker });
  }

  // 4. RDY: −1 per battle, −2 if the formation lost (core §3.2)
  for (const fid of allFormationIds) {
    const f = s.formations[fid];
    if (!f || f.destroyed) continue;
    const lost = result.victorSideId !== undefined && f.sideId !== result.victorSideId;
    const delta = RDY.PER_BATTLE + (lost ? RDY.PER_BATTLE_LOST_EXTRA : 0);
    events.push({ type: 'RDY_CHANGED', formationId: fid, delta,
                  reason: lost ? 'lost battle' : 'fought battle' });
  }

  // which formations are wiped out (all units destroyed/salvage)?
  const outcomeOf = new Map(result.unitOutcomes.map(o => [o.unitId, o.damage]));
  const isDead = (fid: Id) => {
    const f = s.formations[fid];
    return f && f.unitIds.length > 0 && f.unitIds.every(uid => {
      const d = outcomeOf.get(uid) ?? s.units[uid]?.damage;
      return d === 'DESTROYED' || d === 'SALVAGE';
    });
  };
  const survivors = allFormationIds.filter(fid => !isDead(fid) && !s.formations[fid]?.destroyed);

  // 5. mutual auto-LOCK among surviving combatants (core §6.4)
  for (const a of survivors) {
    for (const b of survivors) {
      if (s.formations[a].sideId === s.formations[b].sideId) continue;
      events.push({ type: 'CONTACT_UPGRADED', contact: lockContact(s, s.formations[a].sideId, b),
                    tick: s.tick });
    }
  }

  // 6. salvage: destroyed units in the battle hex go to the hex-controller (core §7.5)
  if (result.hexControlSideId) {
    for (const o of result.unitOutcomes) {
      if (o.damage !== 'DESTROYED' && o.damage !== 'SALVAGE') continue;
      events.push({ type: 'SALVAGE_CREATED', token: {
        id: `salvage:${o.unitId}:${s.tick}`, hex: { ...eng.hex },
        sourceUnitId: o.unitId, heldBy: result.hexControlSideId } });
    }
  }

  // 7. destroy wiped-out formations (their undelivered reports die — M1 behavior)
  for (const fid of allFormationIds) {
    if (isDead(fid) && !s.formations[fid]?.destroyed) {
      events.push({ type: 'FORMATION_DESTROYED', formationId: fid,
                    reason: 'lost in battle', tick: s.tick });
    }
  }

  // 8. withdrawal displacement seeds pursuit (core §7.4)
  for (const [fid, edge] of Object.entries(result.withdrewVia ?? {})) {
    const f = s.formations[fid];
    if (!f || isDead(fid) || f.pos.kind !== 'ground') continue;
    const d = WITHDRAW_DELTA[edge];
    if (!d) continue;
    const to: GroundPos = { ...(f.pos as GroundPos), q: f.pos.q + d.q, r: f.pos.r + d.r };
    if (s.theaters[to.theaterId]?.hexes[`${to.q},${to.r}`]) {
      events.push({ type: 'FORMATION_MOVED', formationId: fid, to,
                    movedKind: 'NORMAL', onRoad: false, headingDeg: 0, tick: s.tick });
    }
  }

  // 9. rout: RDY ≤1 survivors become uncommandable for 2 pulses (core §3.2/§7.4).
  //    RDY deltas above are queued events; recompute the post-battle value here.
  for (const fid of survivors) {
    const f = s.formations[fid];
    const lost = result.victorSideId !== undefined && f.sideId !== result.victorSideId;
    const projected = Math.max(0, f.rdy + RDY.PER_BATTLE + (lost ? RDY.PER_BATTLE_LOST_EXTRA : 0));
    if (projected <= 1) {
      events.push({ type: 'ROUT_STARTED', formationId: fid,
                    untilTick: s.tick + ENGAGEMENT.ROUT_UNCOMMANDABLE_PULSES * CLOCK.TICKS_PER_PULSE,
                    tick: s.tick });
    }
  }

  // 10. resolve & unfreeze
  events.push({ type: 'BATTLE_RESULT_INGESTED', engagementId: eng.id,
                handoffId: eng.handoffId ?? '', tick: s.tick });
  return events;
}
