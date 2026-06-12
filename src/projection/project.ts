/**
 * projection/project.ts — project(truth, sideId, now) → ViewState. Pure. (spec §0, §4)
 *
 * The view is built exclusively from:
 *  - the side's own formations/ledgers (always visible),
 *  - DELIVERED contact snapshots (D-008.5) — never the live truth ladder,
 *  - delivered reports,
 *  - the side's scouted-terrain set.
 * Per-level reveal follows the spec §4 table exactly. Nothing here is ever persisted.
 */
import type { GroundPos, Id, Tick, TruthState } from '../core/types.js';
import { LADDER_NAMES } from '../rules.js';
import { isNight } from '../engine/clock.js';
import type { ContactView, OwnFormationView, ReportView, ScoutedHexView,
              ViewState } from './viewTypes.js';

export function project(truth: TruthState, sideId: Id, now: Tick): ViewState {
  const side = truth.sides[sideId];
  if (!side) throw new Error(`unknown side ${sideId}`);

  const ownFormations: OwnFormationView[] = Object.values(truth.formations)
    .filter(f => f.sideId === sideId && !f.destroyed)
    .map(f => ({
      id: f.id, name: f.name,
      pos: f.pos.kind === 'ground' ? { ...f.pos } : null,
      omp: f.omp, br: f.br, rdy: f.rdy,
      emcon: f.emcon, posture: f.posture,
      onNet: f.onNet,
      currentOrder: f.currentOrderId && truth.orders[f.currentOrderId]
        ? { id: f.currentOrderId, kind: truth.orders[f.currentOrderId].kind,
            completed: !!truth.orders[f.currentOrderId].completed }
        : undefined,
      units: f.unitIds.map(uid => {
        const u = truth.units[uid];
        return { id: u.id, name: u.name, model: u.model, class: u.class,
                 damage: u.damage, ammoState: u.ammoState };
      }),
      inSupply: f.supply.inSupply,
    }));

  const contacts: ContactView[] = Object.values(truth.contacts)
    .filter(c => c.observerSideId === sideId && c.delivered && c.delivered.level >= 1)
    .map(c => {
      const d = c.delivered!;
      const view: ContactView = {
        id: c.id,
        level: d.level,
        levelName: LADDER_NAMES[d.level],
        kind: c.kind,
        estPos: { ...(d.estPos as GroundPos) },
        posErrorHexes: d.posErrorHexes,
        staleAsOfTick: d.asOfTick,
        ageTicks: now - d.asOfTick,
      };
      // spec §4 reveal table — fields strictly by level
      if (d.level >= 2) {
        view.estVector = d.estVector;
        view.estSizeClass = d.estSizeClass;
      }
      if (d.level >= 3) view.estComposition = d.estComposition;
      if (d.level >= 4 && d.toe) view.toe = d.toe.map(t => ({ ...t }));
      return view;
    });

  const reports: ReportView[] = Object.values(truth.reports)
    .filter(r => r.sideId === sideId && r.deliveredTick !== null && !r.lost)
    .sort((a, b) => a.deliveredTick! - b.deliveredTick!)
    .map(r => ({ id: r.id, generatedTick: r.generatedTick,
                 deliveredTick: r.deliveredTick!, text: r.text }));

  const scoutedTerrain: ScoutedHexView[] = (truth.scoutedHexes[sideId] ?? [])
    .map(key => {
      const [theaterId, qr] = key.split(':');
      const hex = truth.theaters[theaterId]?.hexes[qr];
      if (!hex) return null;
      const v: ScoutedHexView = {
        theaterId, q: hex.q, r: hex.r, terrain: hex.terrain, infra: [...hex.infra],
      };
      // hidden objectives stay hidden (D-008.12); fake objectives render as real
      if (hex.objective && (!hex.objective.hidden || hex.objective.ownerSideId === sideId)) {
        v.objective = { vpPerDay: hex.objective.vpPerDay };
      }
      return v;
    })
    .filter((v): v is ScoutedHexView => v !== null);

  return {
    sideId,
    now,
    clockMode: truth.clockMode,
    isNight: isNight(truth, now),
    vp: side.vp,
    ownFormations,
    contacts,
    reports,
    scoutedTerrain,
  };
}
