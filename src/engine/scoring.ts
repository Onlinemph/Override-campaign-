/**
 * engine/scoring.ts — objective control, daily VP accrual, and campaign endings
 * (core §12). Control flips when a side holds an objective uncontested (occupy with no
 * live enemy present); you keep what you took until the enemy takes it. Once per day,
 * every non-fake objective with an owner scores its vpPerDay. The campaign ends when a
 * side reaches the VP threshold, or at the wall-clock end tick (highest VP wins; ties
 * draw).
 */
import { CLOCK } from '../rules.js';
import type { GroundPos, Id, NodePos, TruthState } from '../core/types.js';
import { hexKey } from '../core/types.js';
import type { GameEvent } from '../core/events.js';

/** The single side holding a hex (a live formation there, no live enemy), or null. */
function soleHolderGround(s: TruthState, theaterId: Id, q: number, r: number): Id | null {
  let holder: Id | null = null;
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.pos.kind !== 'ground') continue;
    const p = f.pos as GroundPos;
    if (p.theaterId !== theaterId || p.q !== q || p.r !== r) continue;
    if (holder === null) holder = f.sideId;
    else if (holder !== f.sideId) return null; // contested — the engagement layer owns it
  }
  return holder;
}

function soleHolderNode(s: TruthState, nodeId: Id): Id | null {
  let holder: Id | null = null;
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.pos.kind !== 'node') continue;
    if ((f.pos as NodePos).nodeId !== nodeId) continue;
    if (holder === null) holder = f.sideId;
    else if (holder !== f.sideId) return null;
  }
  return holder;
}

export function scoringPass(s: TruthState, emit: (e: GameEvent) => void): void {
  if (s.ended) return;

  // ── 1. control flips (you take what you hold uncontested) ──
  for (const theater of Object.values(s.theaters)) {
    for (const hex of Object.values(theater.hexes)) {
      const obj = hex.objective;
      if (!obj || obj.fake) continue; // fake objectives are decoys: never owned, never scored
      const holder = soleHolderGround(s, theater.id, hex.q, hex.r);
      if (holder && holder !== obj.ownerSideId) {
        emit({ type: 'OBJECTIVE_CONTROL', theaterId: theater.id,
               hexKey: hexKey(hex.q, hex.r), ownerSideId: holder, tick: s.tick });
      }
    }
  }
  for (const node of Object.values(s.system.nodes)) {
    if (!node.objective) continue;
    const holder = soleHolderNode(s, node.id);
    if (holder && holder !== node.objective.ownerSideId) {
      emit({ type: 'NODE_CONTROL', nodeId: node.id, ownerSideId: holder, tick: s.tick });
    }
  }

  // ── 2. daily VP accrual, anchored so clock compression can't skip a day ──
  while (s.tick - s.lastScoredTick >= CLOCK.TICKS_PER_DAY) {
    const scoreTick = s.lastScoredTick + CLOCK.TICKS_PER_DAY;
    for (const theater of Object.values(s.theaters)) {
      for (const hex of Object.values(theater.hexes)) {
        const obj = hex.objective;
        if (obj && !obj.fake && obj.ownerSideId && obj.vpPerDay) {
          emit({ type: 'VP_CHANGED', sideId: obj.ownerSideId, delta: obj.vpPerDay,
                 reason: `holds objective at ${theater.id} ${hex.q},${hex.r}` });
        }
      }
    }
    for (const node of Object.values(s.system.nodes)) {
      const obj = node.objective;
      if (obj && obj.ownerSideId && obj.vpPerDay) {
        emit({ type: 'VP_CHANGED', sideId: obj.ownerSideId, delta: obj.vpPerDay,
               reason: `holds ${node.name}` });
      }
    }
    emit({ type: 'DAY_SCORED', tick: scoreTick });
  }

  // ── 3. endings (core §12.2) ──
  const threshold = s.config.vpThreshold;
  if (threshold !== undefined) {
    // ties at the threshold in the same step: highest wins, then deterministic by id
    const leaders = Object.values(s.sides)
      .filter(side => side.vp >= threshold)
      .sort((a, b) => b.vp - a.vp || a.id.localeCompare(b.id));
    if (leaders.length > 0) {
      emit({ type: 'CAMPAIGN_ENDED', winnerSideId: leaders[0].id,
             reason: `reached ${threshold} VP`, tick: s.tick });
      return;
    }
  }
  if (s.config.endTick !== undefined && s.tick >= s.config.endTick) {
    const ranked = Object.values(s.sides).sort((a, b) => b.vp - a.vp);
    const winner = ranked.length >= 2 && ranked[0].vp === ranked[1].vp ? null : (ranked[0]?.id ?? null);
    emit({ type: 'CAMPAIGN_ENDED', winnerSideId: winner,
           reason: winner ? `time limit — highest VP` : `time limit — draw`, tick: s.tick });
  }
}
