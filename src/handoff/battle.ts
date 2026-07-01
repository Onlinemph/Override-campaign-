/**
 * handoff/battle.ts — turn a HandoffPackage into a compact battle roster the
 * vendored card builder can open directly (cards/src/web/handoff-import.ts).
 *
 * The campaign tracks each unit only by `model` name + coarse strategic state; the
 * card builder resolves that name against its bundled MegaMek library and renders
 * the full Override record card. So the bridge ships the per-side roster — model
 * names, pilot skills — plus the tabletop *setup* the campaign derived from the
 * fog-of-war state (entry edges, deploy order, intel→initiative, posture, RDY,
 * off-board support) so the tracker can brief the GM without leaking anything the
 * projection wouldn't. Pure (no Node/DOM): the server endpoint and tests call it.
 */
import type { HandoffPackage, Id, TruthState } from '../core/types.js';

export interface BattleRosterUnit {
  /** Campaign unit id — opaque to the card builder, echoed back in the BattleResult. */
  unitId: Id;
  /** Campaign pilot ids for this unit (opaque; map crew outcomes home). */
  pilotIds: Id[];
  /** MegaMek chassis+model, e.g. "Warhammer WHM-6R" — resolved against the library. */
  model: string;
  /** Pilot/crew name, carried for the GM's reference (the card label uses the model). */
  pilot?: string;
  gunnery: number;
  piloting: number;
  /** Coarse strategic state, so the GM can pre-mark the card before play. */
  damage: string;
  ammoState: string;
  // Air / space entry state (SKYWATCH / DEEP SKY) — present only off the ground.
  velocity?: number;
  altLevel?: number;
  fpOnTable?: number;
  jokerFp?: number;
  bingoFp?: number;
}

/** The tabletop setup a side deploys under (core §7.2 / SKYWATCH §7 / DEEP SKY §6). */
export interface BattleRosterSetup {
  entryEdge: HandoffPackage['perSide'][number]['entryEdge'];
  deploysFirst: boolean;
  initiativeBonus: number;
  initiativeBonusTurns: number;
  hiddenSetup: boolean;
  fortified: boolean;
  rdyTnPenalty: 0 | 1 | 2;
  /** Off-board support in range: counts + arrival timing for the briefing. */
  offboard: {
    artillery: number;
    reinforcements: Array<{ arrivesTurn: number; edge: string }>;
    airOnStation: Array<{ arrivesTurn: number; fpOnStation: number }>;
  };
}

export interface BattleRosterSide {
  sideId: Id;
  name: string;
  setup: BattleRosterSetup;
  units: BattleRosterUnit[];
}

export interface BattleRoster {
  handoffId: Id;
  tick: number;
  table: HandoffPackage['table'];
  specialRules: string[];
  /** Map sheets to lay out (terrain hint / band note), and the system node if any. */
  mapSheets: string[];
  nodeName?: string;
  sides: BattleRosterSide[];
}

/** Copy through only the air/space fields that are actually present. */
function airState(u: HandoffPackage['perSide'][number]['units'][number]) {
  return {
    ...(u.velocity !== undefined ? { velocity: u.velocity } : {}),
    ...(u.altLevel !== undefined ? { altLevel: u.altLevel } : {}),
    ...(u.fpOnTable !== undefined ? { fpOnTable: u.fpOnTable } : {}),
    ...(u.jokerFp !== undefined ? { jokerFp: u.jokerFp } : {}),
    ...(u.bingoFp !== undefined ? { bingoFp: u.bingoFp } : {}),
  };
}

/**
 * Build the battle roster from an exported handoff. Units the campaign can't name
 * (`model` missing) fall back to their unit id so the GM still sees a row to fix.
 */
export function buildBattleRoster(s: TruthState, pkg: HandoffPackage): BattleRoster {
  const sides: BattleRosterSide[] = pkg.perSide.map(block => {
    const units: BattleRosterUnit[] = block.units.map(u => {
      const unit = s.units[u.unitId];
      const pilot = unit?.pilotIds.map(id => s.pilots[id]).find(Boolean);
      const [gunnery, piloting] = u.pilotSkills;
      return {
        unitId: u.unitId,
        pilotIds: unit?.pilotIds ?? [],
        // a blank model is as useless as a missing one — fall back to the id so
        // the GM still sees a row to hand-fix in the card builder
        model: unit?.model?.trim() ? unit.model : u.unitId,
        ...(pilot?.name ? { pilot: pilot.name } : {}),
        gunnery,
        piloting,
        damage: u.damage,
        ammoState: u.ammoState,
        ...airState(u),
      };
    });
    const setup: BattleRosterSetup = {
      entryEdge: block.entryEdge,
      deploysFirst: block.deploysFirst,
      initiativeBonus: block.initiativeBonus,
      initiativeBonusTurns: block.initiativeBonusTurns,
      hiddenSetup: block.hiddenSetup,
      fortified: block.fortified,
      rdyTnPenalty: block.rdyTnPenalty,
      offboard: {
        artillery: block.offboard.artillery.length,
        reinforcements: block.offboard.reinforcements.map(r => ({ arrivesTurn: r.arrivesTurn, edge: r.edge })),
        airOnStation: block.offboard.airOnStation.map(a => ({ arrivesTurn: a.arrivesTurn, fpOnStation: a.fpOnStation })),
      },
    };
    return {
      sideId: block.sideId,
      name: s.sides[block.sideId]?.name ?? block.sideId,
      setup,
      units,
    };
  });

  return {
    handoffId: pkg.id,
    tick: pkg.tick,
    table: pkg.table,
    specialRules: pkg.specialRules,
    mapSheets: pkg.mapSpec.sheetsHint,
    ...(pkg.mapSpec.nodeName ? { nodeName: pkg.mapSpec.nodeName } : {}),
    sides,
  };
}
