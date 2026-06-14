/**
 * engine/fires.ts — artillery fire missions, the spotter loop, and counter-battery
 * (core §9.1–9.2). A FIRE order is a *standing* mission: each step the battery shoots
 * once (harassment at pulse/watch scale), Quick-Resolves against whatever truly sits in
 * the target hex, and — win or miss — its own firing hex is auto-revealed at CONTACT to
 * every enemy that can range it. Shoot-and-scoot is the whole lifestyle (core §9.2);
 * fire then MOVE and the enemy holds a confident, stale fix on a hex you've left.
 *
 * Set-piece batteries belong on the table; this Quick Resolution only runs when no
 * battle is pending (the engine is frozen during engagements anyway).
 */
import { ARTILLERY_TAG_RANGE, COUNTER_BATTERY_AUTO_CONTACT_LEVEL, FIRES, LADDER, TERRAIN }
  from '../rules.js';
import type { DamageState, Formation, GroundPos, Id, TruthState } from '../core/types.js';
import { hexKey } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { hexDistance, hexLine } from '../hex/axial.js';
import { rollDice } from '../core/rng.js';
import { formationSensors, registerDetection } from './detection.js';

const DAMAGE_STEPS: DamageState[] = ['OK', 'DAMAGED', 'CRIPPLED', 'DESTROYED'];
function worsen(cur: DamageState, n: number): DamageState {
  const i = DAMAGE_STEPS.indexOf(cur);
  if (i < 0) return cur; // SALVAGE/DESTROYED are terminal
  return DAMAGE_STEPS[Math.min(DAMAGE_STEPS.length - 1, i + n)];
}

/** The longest artillery range across a formation's units (0 if it has no battery). */
export function batteryRange(s: TruthState, f: Formation): number {
  let best = 0;
  for (const uid of f.unitIds) {
    for (const tag of s.units[uid]?.tags ?? []) {
      best = Math.max(best, ARTILLERY_TAG_RANGE[tag] ?? 0);
    }
  }
  return best;
}

function losClear(s: TruthState, a: GroundPos, b: GroundPos): boolean {
  if (a.theaterId !== b.theaterId) return false;
  const line = hexLine(a, b);
  for (let i = 1; i < line.length - 1; i++) {
    const hex = s.theaters[a.theaterId]?.hexes[hexKey(line[i].q, line[i].r)];
    if (hex && TERRAIN[hex.terrain].blocksLos) return false;
  }
  return true;
}

function isSoft(s: TruthState, f: Formation): boolean {
  return f.unitIds.length > 0 && f.unitIds.every(uid =>
    ['INFANTRY', 'BA', 'VEHICLE', 'SUPPORT'].includes(s.units[uid]?.class ?? ''));
}

/** Where is this fire mission aimed — the live contact estimate, or a fixed hex? */
function targetHex(s: TruthState, order: { targetContactId?: Id; targetHex?: GroundPos }):
    GroundPos | null {
  if (order.targetContactId) {
    const c = s.contacts[order.targetContactId];
    const est = c?.delivered?.estPos ?? c?.estPos;
    if (est?.kind === 'ground') return est;
  }
  if (order.targetHex?.kind === 'ground') return order.targetHex;
  return null;
}

export function firesPass(s: TruthState, emit: (e: GameEvent) => void): void {
  if (s.pendingEngagementId) return;

  for (const battery of Object.values(s.formations)) {
    if (battery.destroyed || battery.pos.kind !== 'ground') continue;
    const order = battery.currentOrderId ? s.orders[battery.currentOrderId] : undefined;
    if (!order || order.completed || order.kind !== 'FIRE') continue;
    if (s.tick < order.effectiveTick) continue;
    const range = batteryRange(s, battery);
    if (range === 0) continue; // no tubes
    if (battery.unitIds.every(uid => s.units[uid]?.ammoState === 'DRY')) continue;

    const from = battery.pos as GroundPos;
    const tgt = targetHex(s, order);
    if (!tgt || tgt.theaterId !== from.theaterId || hexDistance(from, tgt) > range) continue;

    // intel penalty: LOCK clean, CONTACT −2, anything less (or a bare hex) −4 — unless a
    // friendly forward observer holds LOS to the target (core §9.1 the spotter loop)
    const level = order.targetContactId ? (s.contacts[order.targetContactId]?.level ?? 0) : 0;
    const spotter = Object.values(s.formations).some(o => !o.destroyed &&
      o.sideId === battery.sideId && o.id !== battery.id && o.pos.kind === 'ground' &&
      losClear(s, o.pos as GroundPos, tgt));
    let penalty = 0;
    if (!spotter) {
      penalty = level >= LADDER.ARTY_AIR_TARGETING_MIN_LEVEL ? LADDER.TARGETING_PENALTY_AT_CONTACT
        : (level >= LADDER.MAX_LEVEL ? 0 : LADDER.TARGETING_PENALTY_BELOW_CONTACT);
      if (level >= LADDER.MAX_LEVEL) penalty = 0; // LOCK is clean
    }

    // the shot
    const r = rollDice(s.seed, s.seedCursor, '2d6');
    const brBonus = Math.floor(battery.br / FIRES.BR_DIVISOR);
    const total = r.result + brBonus + penalty;
    emit({ type: 'DIE_ROLLED', roll: { id: `roll:${s.seedCursor}`, tick: s.tick,
      purpose: `fire mission ${battery.name} → ${tgt.q},${tgt.r} ` +
        `(2d6 ${r.result} +BR ${brBonus}${penalty ? ` ${penalty} intel` : ''} = ${total} vs ${FIRES.HIT_TN})`,
      dice: '2d6', result: r.result, seedCursor: r.nextCursor - 2 } });
    emit({ type: 'FORMATION_FIRED', formationId: battery.id, tick: s.tick });

    // damage whoever is actually in the hex (a stale fix lands on empty ground)
    if (total >= FIRES.HIT_TN) {
      const victims = Object.values(s.formations).filter(o => !o.destroyed &&
        o.sideId !== battery.sideId && o.pos.kind === 'ground' &&
        (o.pos as GroundPos).theaterId === tgt.theaterId &&
        (o.pos as GroundPos).q === tgt.q && (o.pos as GroundPos).r === tgt.r);
      for (const victim of victims) {
        const steps = 1 + (total - FIRES.HIT_TN >= FIRES.BIG_MARGIN ? 1 : 0)
          + (FIRES.SOFT_DOUBLE && isSoft(s, victim) ? 1 : 0);
        const uid = victim.unitIds.find(u => s.units[u]?.damage !== 'DESTROYED'
          && s.units[u]?.damage !== 'SALVAGE');
        if (uid) {
          emit({ type: 'UNIT_STATE_CHANGED', unitId: uid,
            damage: worsen(s.units[uid].damage, steps), ammoState: s.units[uid].ammoState });
        }
      }
    }

    // counter-battery: the firing hex is revealed at CONTACT to every enemy that can
    // range it — sensors OR a battery within its own range (core §9.2)
    counterBattery(s, emit, battery, from);
  }
}

function counterBattery(
  s: TruthState, emit: (e: GameEvent) => void, battery: Formation, from: GroundPos,
): void {
  for (const sideId of Object.keys(s.sides)) {
    if (sideId === battery.sideId) continue;
    let canRange = false;
    // a sensor station / mobile HQ that ranges the hex
    for (const fac of Object.values(s.facilities)) {
      if (fac.sideId !== sideId || !fac.sensorStation || fac.pos.kind !== 'ground') continue;
      if (fac.pos.theaterId === from.theaterId &&
          hexDistance(fac.pos, from) <= fac.sensorStation.active) { canRange = true; break; }
    }
    // a formation whose sensors or own tubes range the hex
    if (!canRange) {
      for (const o of Object.values(s.formations)) {
        if (o.destroyed || o.sideId !== sideId || o.pos.kind !== 'ground') continue;
        const op = o.pos as GroundPos;
        if (op.theaterId !== from.theaterId) continue;
        const d = hexDistance(op, from);
        const sns = formationSensors(s, o);
        if (d <= Math.max(sns.active, batteryRange(s, o))) { canRange = true; break; }
      }
    }
    if (!canRange) continue;
    registerDetection(s, emit, sideId, battery, COUNTER_BATTERY_AUTO_CONTACT_LEVEL,
      { id: `counter-battery:${sideId}`, name: 'counter-battery radar', alwaysOnNet: true },
      { setLevel: true, note: 'firing hex (counter-battery)' });
  }
}
