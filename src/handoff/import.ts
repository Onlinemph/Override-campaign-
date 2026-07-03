/**
 * handoff/import.ts — ingest a BattleResult back into truth (core §3.2, §6.4, §7.4, §7.5).
 *
 * Pure: produces the ordered GameEvent list that applies the tabletop outcome —
 * damage/ammo, pilots, ejection markers, RDY (−1, −2 if lost), mutual auto-LOCK,
 * salvage for the hex-controller, formation destruction, withdrawal displacement, and
 * rout for broken formations. The final BATTLE_RESULT_INGESTED unfreezes the campaign.
 */
import { CAREER, CLOCK, DEEPSKY, ENGAGEMENT, LADDER, RDY } from '../rules.js';
import { battleXp } from '../engine/career.js';
import { groundHexUnder, theaterAirHex } from '../engine/air.js';
import { hexDistance } from '../hex/axial.js';
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
  return {
    level: 4, estPos: structuredClone(f.pos), posErrorHexes: 0,
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

  // 1. unit damage / ammo / remaining fuel (M3: the record sheet's FP comes home) —
  //    and the marked-up card itself persists (ext): the same boxes reappear in the
  //    next battle unless the unit visits the shop. Fuel is dropped from the blob
  //    (it rides the exact fpRemaining ledger instead).
  for (const o of result.unitOutcomes) {
    if (!s.units[o.unitId]) continue;
    let sheet: Record<string, unknown> | undefined;
    if (o.sheetDamage && typeof o.sheetDamage === 'object') {
      sheet = { ...o.sheetDamage };
      delete sheet.fuel;
      if (Object.keys(sheet).length === 0) sheet = undefined;
    }
    events.push({ type: 'UNIT_STATE_CHANGED', unitId: o.unitId,
                  damage: o.damage, ammoState: o.ammoState,
                  ...(o.fpRemaining !== undefined ? { fpRemaining: o.fpRemaining } : {}),
                  ...(sheet ? { sheetDamage: sheet } : {}) });
  }
  // 2. pilots: status (wounds schedule their recovery), then career XP for the living.
  //    A live MASH unit on the pilot's side shortens the bed rest (ext).
  const hasMash = (sideId: Id) => Object.values(s.units).some(u =>
    u.sideId === sideId && u.tags.includes('MASH') &&
    u.damage !== 'DESTROYED' && u.damage !== 'SALVAGE');
  for (const o of result.unitOutcomes) {
    for (const p of o.pilotOutcomes) {
      if (!s.pilots[p.pilotId]) continue;
      // recovery scales per hit taken: 3 days each, 1 with a MASH on the side
      const perHit = s.units[o.unitId] && hasMash(s.units[o.unitId].sideId)
        ? CAREER.WOUND_RECOVERY_DAYS_MASH : CAREER.WOUND_RECOVERY_DAYS;
      const hits = Math.max(1, p.hits ?? 1);
      events.push({ type: 'PILOT_STATE_CHANGED', pilotId: p.pilotId, status: p.status,
        ...(p.status === 'WOUNDED'
          ? { recoverAtTick: s.tick + hits * perHit * CLOCK.TICKS_PER_DAY }
          : {}) });
      // XP: surviving crews learn — KIA/captured crews' stories end here
      if (p.status === 'KIA' || p.status === 'CAPTURED') continue;
      const won = result.victorSideId !== undefined &&
        s.units[o.unitId]?.sideId === result.victorSideId;
      const kills = p.kills ?? 0;
      events.push({ type: 'PILOT_XP', pilotId: p.pilotId,
                    xpDelta: battleXp(won, kills), kills,
                    reason: won ? 'battle won' : 'battle survived', tick: s.tick });
    }
  }
  // 3. ejections → DOWNED_CREW markers (SKYWATCH §8.4 / core §10.4).
  //    The tracker can't know board coordinates, so it may omit pos; fall the
  //    crew down at the battle hex (or a combatant's position as a last resort).
  const ejectFallback = eng.hex
    ?? s.formations[allFormationIds[0]]?.pos
    ?? { kind: 'ground' as const, theaterId: '', q: 0, r: 0 };
  for (const ej of result.ejections) {
    const marker: Marker = {
      id: `marker:downed:${ej.pilotId}:${s.tick}`, kind: 'DOWNED_CREW',
      pos: ej.pos ?? structuredClone(ejectFallback), payload: { pilotId: ej.pilotId },
      beaconActive: true,
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

  // 6. salvage: destroyed units in the battle hex go to the hex-controller (core §7.5).
  if (result.hexControlSideId && eng.hex) {
    for (const o of result.unitOutcomes) {
      if (o.damage !== 'DESTROYED' && o.damage !== 'SALVAGE') continue;
      events.push({ type: 'SALVAGE_CREATED', token: {
        id: `salvage:${o.unitId}:${s.tick}`, hex: { ...eng.hex },
        sourceUnitId: o.unitId, heldBy: result.hexControlSideId } });
    }
  }
  // 6b (ext): air kills rain down — wrecks fall on the ground under the merge and become
  // salvage for whoever held the sky. No victor ⇒ the wrecks burn in, unclaimed.
  if (eng.domain === 'AIR' && eng.airPos && result.victorSideId) {
    const merge = { q: eng.airPos.gridQ, r: eng.airPos.gridR };
    // D-037 (congruent sky): the wreckage falls onto the hex directly under the merge
    // when the fight was over a theater; else onto the nearest hex of the nearest region.
    const directly = groundHexUnder(s, merge);
    const under = directly
      ? { t: s.theaters[directly.theaterId], d: 0 }
      : Object.values(s.theaters)
          .map(t => ({ t, d: hexDistance(theaterAirHex(s, t.id), merge) }))
          .sort((a, b) => a.d - b.d || a.t.id.localeCompare(b.t.id))[0];
    const local = directly ? { q: directly.q, r: directly.r } : merge;
    const fall = under && (under.t.hexes[`${local.q},${local.r}`]
      ? local
      : Object.keys(under.t.hexes)
          .map(k => { const [q, r] = k.split(',').map(Number); return { q, r }; })
          .sort((a, b) => hexDistance(a, local) - hexDistance(b, local)
                        || a.q - b.q || a.r - b.r)[0]);
    if (under && fall) {
      const hex: GroundPos = { kind: 'ground', theaterId: under.t.id, q: fall.q, r: fall.r };
      for (const o of result.unitOutcomes) {
        if (o.damage !== 'DESTROYED' && o.damage !== 'SALVAGE') continue;
        events.push({ type: 'SALVAGE_CREATED', token: {
          id: `salvage:${o.unitId}:${s.tick}`, hex,
          sourceUnitId: o.unitId, heldBy: result.victorSideId } });
      }
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

  // 9a-bis. the JumpShip taboo (DEEP SKY §7.4): killing one costs the killer −10 VP
  //         and hands the wronged side a Reprisal
  for (const o of result.unitOutcomes) {
    const u = s.units[o.unitId];
    if (!u || u.class !== 'JUMPSHIP') continue;
    if (o.damage !== 'DESTROYED') continue;
    const killerSideId = u.sideId === eng.attackerSideId ? eng.defenderSideId : eng.attackerSideId;
    events.push({ type: 'VP_CHANGED', sideId: killerSideId,
                  delta: DEEPSKY.TABOO.JUMPSHIP_KILL_VP,
                  reason: 'JumpShip destroyed — the taboo holds (DEEP SKY 7.4)' });
    events.push({ type: 'REPRISAL_OWED', sideId: u.sideId,
                  reason: 'JumpShip killed: off-map reinforcement or intel windfall due',
                  tick: s.tick });
  }

  // 9b. air engagements (M3): the merge consumed the mission — surviving flights exit
  //     the table and head home (SKYWATCH §8.1; pursuit may re-trigger on the grid)
  if (eng.domain === 'AIR') {
    for (const fid of survivors) {
      const f = s.formations[fid];
      const order = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;
      if (order && !order.completed) {
        events.push({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: fid, tick: s.tick });
      }
      if (f.pos.kind === 'air') {
        events.push({ type: 'AIR_PHASE', formationId: fid, phase: 'RTB', tick: s.tick });
      }
    }
  }

  // 10. resolve & unfreeze
  events.push({ type: 'BATTLE_RESULT_INGESTED', engagementId: eng.id,
                handoffId: eng.handoffId ?? '', tick: s.tick });
  return events;
}
