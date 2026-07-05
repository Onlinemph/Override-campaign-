/**
 * engine/fires.ts — artillery fire missions, the spotter loop, and counter-battery
 * (core §9.1–9.2). A FIRE order is a *standing* mission: each step the battery shoots
 * once (harassment at pulse/watch scale), Quick-Resolves against whatever truly sits in
 * the target hex, and — win or miss — its own firing hex is auto-revealed at CONTACT to
 * every enemy that can range it. Shoot-and-scoot is the whole lifestyle (core §9.2);
 * fire then MOVE and the enemy holds a confident, stale fix on a hex you've left.
 *
 * D-052 — the guns are real now: battery strength is graded from the tubes on the
 * cards (a Long Tom battalion is not a lone Thumper), sustained fire DRAINS THE
 * MAGAZINE (each shot risks walking the tubes FULL → PARTIAL → DRY — REARM from a
 * depot to refill), fire missions can flatten FACILITIES (the counter-battery answer
 * to a photographed capital emplacement), and a hex whose enemy facility your side
 * has spotted is a surveyed grid — no intel penalty. Ranges are halved from the
 * printed mapsheet values (500 m hexes read 1:1 onto 18 km was generous — D-052).
 *
 * D-053 — what shellfire actually does to a moving formation (user ruling): an
 * 18 km hex is a dispersed march column, not a parking lot — so a barrage that
 * lands SUPPRESSES (movement halved in the sheaf and the adjacent hexes, readiness
 * shaved in the sheaf itself) and only RARELY destroys: each formation under the
 * sheaf risks a direct hit on a separate 2d6 ≥ DIRECT_HIT_TN (massed batteries +1).
 * Artillery's operational job is to slow, rattle, and canalize; the killing is done
 * on the tabletop. Buildings are the exception — they can't disperse, so facility
 * bombardment keeps its D-052 teeth.
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

/** The unit ids in a formation that actually carry tubes. */
export function tubeUnits(s: TruthState, f: Formation): Id[] {
  return f.unitIds.filter(uid =>
    (s.units[uid]?.tags ?? []).some(tag => ARTILLERY_TAG_RANGE[tag] !== undefined));
}

/** D-052: the battery's punch — Σ arty strength over live tubes with ammunition. */
export function batteryStrength(s: TruthState, f: Formation): number {
  let total = 0;
  for (const uid of tubeUnits(s, f)) {
    const u = s.units[uid];
    if (!u || u.damage === 'DESTROYED' || u.damage === 'SALVAGE') continue;
    if (u.ammoState === 'DRY') continue;
    total += u.arty ?? 1;
  }
  return total;
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
    const strength = batteryStrength(s, battery);
    if (strength === 0) continue; // every tube dry or dead — REARM before you FIRE

    const from = battery.pos as GroundPos;
    const tgt = targetHex(s, order);
    if (!tgt || tgt.theaterId !== from.theaterId || hexDistance(from, tgt) > range) continue;

    // D-052: a spotted enemy facility makes its hex a surveyed grid — buildings hold still
    const facTargets = Object.values(s.facilities).filter(fac =>
      fac.sideId !== battery.sideId && fac.pos.kind === 'ground' &&
      fac.pos.theaterId === tgt.theaterId && fac.pos.q === tgt.q && fac.pos.r === tgt.r &&
      fac.damage !== 'DESTROYED');
    const surveyed = facTargets.some(fac => (fac.knownTo ?? []).includes(battery.sideId));

    // intel penalty: LOCK clean, CONTACT −2, anything less (or a bare hex) −4 — unless a
    // friendly forward observer holds LOS to the target (core §9.1 the spotter loop),
    // or the hex holds a facility this side has photographed (D-052)
    const level = order.targetContactId ? (s.contacts[order.targetContactId]?.level ?? 0) : 0;
    const spotter = Object.values(s.formations).some(o => !o.destroyed &&
      o.sideId === battery.sideId && o.id !== battery.id && o.pos.kind === 'ground' &&
      losClear(s, o.pos as GroundPos, tgt));
    let penalty = 0;
    if (!spotter && !surveyed) {
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
        `(2d6 ${r.result} +BR ${brBonus}${penalty ? ` ${penalty} intel` : ''} = ${total} vs ${FIRES.HIT_TN}, strength ${strength})`,
      dice: '2d6', result: r.result, seedCursor: r.nextCursor - 2 } });
    emit({ type: 'FORMATION_FIRED', formationId: battery.id, tick: s.tick });

    // D-053: a barrage that lands SUPPRESSES the sheaf — movement halved in the
    // target hex and its six neighbors, readiness shaved in the target hex itself
    // (soft targets double: trucks and infantry hate shellfire). A stale fix still
    // lands on empty ground and suppresses nobody.
    const massed = strength >= FIRES.MASSED_STRENGTH ? 1 : 0;
    if (total >= FIRES.HIT_TN) {
      const until = s.tick + FIRES.SUPPRESS_TICKS;
      const enemiesNear = Object.values(s.formations).filter(o => !o.destroyed &&
        !o.mounted && o.sideId !== battery.sideId && o.pos.kind === 'ground' &&
        (o.pos as GroundPos).theaterId === tgt.theaterId &&
        hexDistance(o.pos as GroundPos, tgt) <= 1);
      for (const victim of enemiesNear) {
        const inSheaf = hexDistance(victim.pos as GroundPos, tgt) === 0;
        emit({ type: 'FORMATION_SUPPRESSED', formationId: victim.id,
               untilTick: until, tick: s.tick });
        if (!inSheaf) continue; // adjacent: heads down, keep crawling

        emit({ type: 'RDY_CHANGED', formationId: victim.id,
               delta: -(FIRES.SUPPRESS_RDY * (FIRES.SOFT_DOUBLE && isSoft(s, victim) ? 2 : 1)),
               reason: 'shelled' });
        // the rare direct hit: one 2d6 per formation under the sheaf, massed +1.
        // An 18 km hex is a dispersed column; even a good sheaf mostly finds dirt.
        const dh = rollDice(s.seed, s.seedCursor, '2d6');
        emit({ type: 'DIE_ROLLED', roll: { id: `roll:${s.seedCursor}`, tick: s.tick,
          purpose: `direct hit? ${battery.name} → ${victim.name} `
            + `(2d6 ${dh.result}${massed ? ' +1 massed' : ''} vs ${FIRES.DIRECT_HIT_TN})`,
          dice: '2d6', result: dh.result, seedCursor: dh.nextCursor - 2 } });
        if (dh.result + massed >= FIRES.DIRECT_HIT_TN) {
          const steps = 1 + (FIRES.SOFT_DOUBLE && isSoft(s, victim) ? 1 : 0);
          const uid = victim.unitIds.find(u => s.units[u]?.damage !== 'DESTROYED'
            && s.units[u]?.damage !== 'SALVAGE');
          if (uid) {
            emit({ type: 'UNIT_STATE_CHANGED', unitId: uid,
              damage: worsen(s.units[uid].damage, steps), ammoState: s.units[uid].ammoState });
            emit({ type: 'GM_NOTE', tick: s.tick,
              text: `direct hit: ${battery.name} lands one on ${victim.name}` });
          }
        }
      }
      // D-052: shells flatten buildings — they can't disperse, so bombardment of a
      // fixed installation keeps its teeth (the standoff answer to a capital battery)
      for (const fac of facTargets) {
        const steps = 1 + massed + (total - FIRES.HIT_TN >= FIRES.BIG_MARGIN ? 1 : 0);
        const after = worsen(fac.damage ?? 'OK', steps);
        emit({ type: 'FACILITY_DAMAGED', facilityId: fac.id, damage: after, tick: s.tick });
        emit({ type: 'GM_NOTE', tick: s.tick,
          text: `bombardment: ${battery.name} hits ${fac.name} — ${after}`
            + (after === 'DESTROYED' ? ' (out of action)' : '') });
      }
    }

    // D-052: the magazine is finite — each fire mission risks walking every live
    // tube one ammo state down. REARM at a depot/convoy is the refill.
    const dep = rollDice(s.seed, s.seedCursor, '2d6');
    emit({ type: 'DIE_ROLLED', roll: { id: `roll:${s.seedCursor}`, tick: s.tick,
      purpose: `ammo depletion ${battery.name} (2d6 ≤ ${FIRES.AMMO_DEPLETION_ON} drains)`,
      dice: '2d6', result: dep.result, seedCursor: dep.nextCursor - 2 } });
    if (dep.result <= FIRES.AMMO_DEPLETION_ON) {
      const NEXT: Record<string, 'PARTIAL' | 'DRY'> = { FULL: 'PARTIAL', PARTIAL: 'DRY' };
      for (const uid of tubeUnits(s, battery)) {
        const u = s.units[uid];
        if (!u || u.damage === 'DESTROYED' || u.damage === 'SALVAGE') continue;
        const next = NEXT[u.ammoState];
        if (next) emit({ type: 'UNIT_STATE_CHANGED', unitId: uid,
                         damage: u.damage, ammoState: next });
      }
      emit({ type: 'GM_NOTE', tick: s.tick,
        text: `${battery.name}: magazines running low (sustained fire)` });
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
      if (fac.damage === 'DESTROYED') continue; // D-052: flattened radar ranges nothing
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
