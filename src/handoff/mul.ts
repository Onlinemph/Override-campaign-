/**
 * handoff/mul.ts — best-effort MegaMek unit list (.mul) export from a HandoffPackage
 * (spec §3.6, "optional v2"). One file per side; chassis/model are split heuristically
 * from `Unit.model` ("Warhammer WHM-6R" → chassis "Warhammer", model "WHM-6R"), so the
 * names must match MegaMek's cache to load cleanly — hand-fix in MegaMek if they don't.
 */
import type { HandoffPackage, Id, TruthState } from '../core/types.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
}

function splitChassisModel(full: string): { chassis: string; model: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { chassis: parts[0], model: '' };
  return { chassis: parts.slice(0, -1).join(' '), model: parts[parts.length - 1] };
}

export function buildMul(s: TruthState, pkg: HandoffPackage, sideId: Id): string {
  const block = pkg.perSide.find(p => p.sideId === sideId);
  if (!block) throw new Error(`side ${sideId} is not in handoff ${pkg.id}`);

  const entities = block.units.map(u => {
    const unit = s.units[u.unitId];
    const { chassis, model } = splitChassisModel(unit?.model ?? u.unitId);
    const pilot = unit?.pilotIds.map(id => s.pilots[id]).find(Boolean);
    const name = pilot?.name ?? 'MechWarrior';
    const [gunnery, piloting] = u.pilotSkills;
    const lines = [
      `  <entity chassis="${esc(chassis)}"${model ? ` model="${esc(model)}"` : ''}>`,
      `    <pilot name="${esc(name)}" gunnery="${gunnery}" piloting="${piloting}"/>`,
    ];
    if (u.fpOnTable !== undefined) {
      lines.push(`    <!-- fuel on table: ${u.fpOnTable} FP` +
        (u.jokerFp !== undefined ? ` · JOKER ${u.jokerFp} · BINGO ${u.bingoFp}` : '') +
        ` · ammo ${esc(u.ammoState)} · damage ${esc(u.damage)} -->`);
    } else {
      lines.push(`    <!-- ammo ${esc(u.ammoState)} · damage ${esc(u.damage)} -->`);
    }
    lines.push('  </entity>');
    return lines.join('\n');
  });

  const setup = [
    `entry edge ${block.entryEdge}`,
    block.deploysFirst ? 'DEPLOYS FIRST' : 'deploys second',
    block.initiativeBonus ? `+${block.initiativeBonus} initiative for ${block.initiativeBonusTurns} turns` : '',
    block.hiddenSetup ? 'HIDDEN SETUP' : '',
    block.fortified ? 'FORTIFIED' : '',
    block.rdyTnPenalty ? `RDY: +${block.rdyTnPenalty} to all TNs` : '',
  ].filter(Boolean).join(' · ');

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- OVERRIDE GM Tool handoff ${esc(pkg.id)} · tick ${pkg.tick} · table ${pkg.table} -->`,
    `<!-- side ${esc(sideId)}: ${esc(setup)} -->`,
    pkg.specialRules.length ? `<!-- special: ${esc(pkg.specialRules.join(' · '))} -->` : '',
    `<unit version="1.0">`,
    ...entities,
    `</unit>`,
  ].filter(Boolean).join('\n') + '\n';
}
