/**
 * Record-sheet style paper doll for BIPED and TRIPOD 'Mechs: a blocky mech
 * silhouette with armor as open circles in the UPPER segment of each location
 * and structure as squares in the LOWER segment. Pure string builder (SVG).
 *
 * The pips reuse the damage-tracker's grouping contract: each location is a
 * `<g class="mloc {area}">` holding two `<g class="hexrow">` groups (armor then
 * structure), whose children carry `bpip armor` / `bpip struct` classes. So the
 * existing applyDamageMarks (group ordinals, struct-destruction, .pip-hit) works
 * with only the click selector extended to `.bpip`.
 *
 * Tripods add a third (center) leg in the gap between the legs; the area code
 * "cl" flows through the dropdown + applyDamageMarks generically. Quads keep the
 * grid doll (mech-card's paperDoll).
 */
import type { DropshipCard, FighterCard, OverrideCard, ProtoMechCard, VehicleCard } from "../core/index.js";

const FILL = "#c7c7c0", STROKE = "#4c4c46", DARK = "#9a9a92";
const rr = (x: number, y: number, w: number, h: number, r = 5, fill = FILL): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${STROKE}" stroke-width="1.6"/>`;
const poly = (pts: number[][]): string =>
  `<polygon points="${pts.map((p) => p.join(",")).join(" ")}" fill="${FILL}" stroke="${STROKE}" stroke-width="1.6"/>`;

// --- Armor-type pip shapes. Each armor type draws its armor pips as a distinct
// shape so types read apart at a glance. "default" keeps each view's normal pip
// (a circle on the doll); special armors use a polygon. Structure stays a square.
export type ArmorShape = "default" | "diamond" | "triangle" | "octagon" | "pentagon";
export function armorShape(armorType?: string): ArmorShape {
  const s = (armorType ?? "").toLowerCase();
  if (/ferro|lamellor/.test(s)) return "diamond"; // Ferro-Fibrous (Light/Heavy/Lamellor)
  if (/stealth/.test(s)) return "triangle";
  if (/hardened/.test(s)) return "pentagon"; // shield — clearly distinct from the round default
  if (/reflective|reactive/.test(s)) return "octagon";
  return "default"; // Standard, Primitive, Industrial, Commercial, …
}
/** Clean the "(Inner Sphere)"/"(Clan)" suffix for display. */
export function armorTypeLabel(armorType?: string): string {
  return (armorType ?? "Standard").replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim() || "Standard";
}
/** Unit-box (0..1) polygons for each special shape. */
const SHAPE_POLY: Partial<Record<ArmorShape, number[][]>> = {
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  triangle: [[0.5, 0.04], [0.96, 0.96], [0.04, 0.96]],
  octagon: [[0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]],
  pentagon: [[0.5, 0], [1, 0.4], [0.81, 1], [0.19, 1], [0, 0.4]],
};
/** One armor pip as the shape's SVG element, centred at (cx,cy) with radius r. */
function armorPip(shape: ArmorShape, cx: number, cy: number, r: number): string {
  const p = SHAPE_POLY[shape];
  if (!p) return `<circle class="bpip armor" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"/>`;
  const pts = p.map(([px, py]) => `${(cx + (px! - 0.5) * 2 * r).toFixed(1)},${(cy + (py! - 0.5) * 2 * r).toFixed(1)}`).join(" ");
  return `<polygon class="bpip armor" points="${pts}"/>`;
}
let dollArmorShape: ArmorShape = "default"; // set per-doll before rendering its pips

/** Lay `n` pips in a grid filling [x,y,w,h]; circles for armor, squares for structure. */
function pips(x: number, y: number, w: number, h: number, n: number, kind: "armor" | "struct"): string {
  if (n <= 0) return "";
  let r = 4, step = 0, cols = 1;
  for (let rad = 4; rad >= 1.3; rad -= 0.1) {
    const sp = rad * 2 + 1.6;
    const c = Math.max(1, Math.floor(w / sp));
    const ro = Math.max(1, Math.floor(h / sp));
    r = rad;
    step = sp;
    cols = c;
    if (c * ro >= n) break;
  }
  const usedRows = Math.ceil(n / cols);
  let out = "";
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const rowCount = Math.min(cols, n - row * cols);
    const cx = x + (w - rowCount * step) / 2 + step / 2 + col * step;
    const cy = y + step / 2 + row * step + Math.max(0, (h - usedRows * step) / 2);
    out +=
      kind === "armor"
        ? armorPip(dollArmorShape, cx, cy, r)
        : `<rect class="bpip struct" x="${(cx - r * 0.85).toFixed(1)}" y="${(cy - r * 0.85).toFixed(1)}" width="${(r * 1.7).toFixed(1)}" height="${(r * 1.7).toFixed(1)}"/>`;
  }
  return out;
}

type Zone = [number, number, number, number];
/** One location: armor pips (upper zone) + structure pips (lower zone), grouped for the tracker. */
function loc(area: string, armorZone: Zone, structZone: Zone, armor: number, structure: number): string {
  return (
    `<g class="mloc ${area}">` +
    `<g class="hexrow">${pips(armorZone[0], armorZone[1], armorZone[2], armorZone[3], armor, "armor")}</g>` +
    `<g class="hexrow">${pips(structZone[0], structZone[1], structZone[2], structZone[3], structure, "struct")}</g>` +
    `</g>`
  );
}

/** A per-location damage dropdown overlaid on the doll (0..armor+structure). */
function ctl(area: string, name: string, hits: string, max: number, left: number, top: number): string {
  const opts = Array.from({ length: max + 1 }, (_, i) => `<option value="${i}">${i}</option>`).join("");
  return (
    `<label class="dmg-ctl" data-area="${area}" style="left:${left}%;top:${top}%">` +
    `<span class="dmg-name">${name}</span><span class="dmg-hits">${hits}</span>` +
    `<select aria-label="${name} damage">${opts}</select></label>`
  );
}

/** True when this card should use the silhouette doll (bipeds + tripods; quads use the grid). */
export function isBipedDoll(card: OverrideCard): boolean {
  if (/quad/i.test(card.config)) return false;
  return /biped|tripod/i.test(card.config) || card.armor.centerLeg !== undefined;
}

/** Render the biped/tripod record-sheet paper doll as an SVG string. */
export function bipedDoll(card: OverrideCard): string {
  dollArmorShape = armorShape(card.armorType);
  const a = card.armor;
  const s = card.structure;
  const tripod = a.centerLeg !== undefined || s.centerLeg !== undefined;
  const spread = tripod ? 22 : 0; // tripods: splay the outer legs to clear the center leg
  // Tripods get a taller hip block (room for the TORSO dropdown to sit clear of
  // the torso pips) and the legs slide down to meet its lower edge.
  const hipH = tripod ? 32 : 22;
  const legDy = tripod ? 12 : 0;
  const seg =
    // Head + visor + neck
    rr(144, 18, 52, 40, 7) +
    `<rect x="156" y="26" width="28" height="8" rx="2" fill="${DARK}"/>` +
    rr(160, 56, 20, 10, 3) +
    // Shoulders
    poly([[60, 74], [130, 60], [130, 100], [68, 110]]) +
    poly([[280, 74], [210, 60], [210, 100], [272, 110]]) +
    // Torso: chest (armor) + abdomen (structure)
    rr(130, 60, 80, 74, 8) +
    rr(140, 132, 60, 46, 7) +
    // Arms: upper (armor) + forearm (structure) + hand
    rr(62, 100, 34, 54, 8) + rr(60, 152, 34, 60, 8) + rr(60, 210, 32, 16, 4) +
    rr(244, 100, 34, 54, 8) + rr(246, 152, 34, 60, 8) + rr(248, 210, 32, 16, 4) +
    // Tripod center leg (behind, in the gap): thigh (armor) + shin (structure) + foot.
    (tripod ? rr(153, 200 + legDy, 34, 64, 9, DARK) + rr(156, 266 + legDy, 28, 86, 9, DARK) + rr(154, 350 + legDy, 32, 18, 5, DARK) : "") +
    // Hips + legs: thigh (armor) + shin (structure) + foot. Tripods splay the legs out.
    rr(124 - spread, 176, 92 + 2 * spread, hipH, 7) +
    rr(112 - spread, 196 + legDy, 40, 70, 9) + rr(114 - spread, 264 + legDy, 34, 90, 9) + rr(102 - spread, 352 + legDy, 50, 20, 5) +
    rr(188 + spread, 196 + legDy, 40, 70, 9) + rr(192 + spread, 264 + legDy, 34, 90, 9) + rr(188 + spread, 352 + legDy, 50, 20, 5) +
    // Torso-rear box
    rr(142, 382, 56, 24, 5, "#e7e7e1");

  const dolls =
    loc("hd", [148, 37, 44, 11], [148, 47, 44, 10], a.head, s.head) +
    loc("la", [63, 102, 32, 50], [61, 154, 32, 56], a.leftArm, s.leftArm) +
    loc("ra", [245, 102, 32, 50], [247, 154, 32, 56], a.rightArm, s.rightArm) +
    loc("ct", [133, 64, 74, 66], [142, 134, 56, 42], a.torso, s.torso) +
    loc("ll", [113 - spread, 198 + legDy, 38, 66], [115 - spread, 266 + legDy, 32, 86], a.leftLeg, s.leftLeg) +
    loc("rl", [189 + spread, 198 + legDy, 38, 66], [193 + spread, 266 + legDy, 32, 86], a.rightLeg, s.rightLeg) +
    (tripod ? loc("cl", [155, 202 + legDy, 30, 60], [158, 268 + legDy, 24, 82], a.centerLeg ?? 0, s.centerLeg ?? 0) : "") +
    loc("tr", [144, 384, 52, 20], [0, 0, 0, 0], a.rear, 0);

  const legend =
    `${armorPip(dollArmorShape, 6, 456, 4.5)}<text class="bdoll-lbl" x="15" y="459" text-anchor="start">armor</text>` +
    `<rect class="bpip struct" x="62" y="451" width="9" height="9"/><text class="bdoll-lbl" x="76" y="459" text-anchor="start">structure</text>`;

  // Per-location damage dropdowns positioned over the doll (fill armor then structure).
  // Tripods: a leg hit (2d6 = 5 or 9) is followed by a d6 to pick the leg.
  const controls =
    ctl("hd", "HEAD", "12", a.head + s.head, 50, 4) +
    ctl("la", "L ARM", "10,11", a.leftArm + s.leftArm, 8, 30) +
    ctl("ra", "R ARM", "3,4", a.rightArm + s.rightArm, 92, 30) +
    ctl("ct", "TORSO", "6,7,8", a.torso + s.torso, 50, tripod ? 41 : 43) +
    ctl("ll", "L LEG", tripod ? "d6 1-2" : "9", a.leftLeg + s.leftLeg, tripod ? 9 : 16, tripod ? 74 : 71) +
    ctl("rl", "R LEG", tripod ? "d6 5-6" : "5", a.rightLeg + s.rightLeg, tripod ? 91 : 84, tripod ? 74 : 71) +
    (tripod ? ctl("cl", "C LEG", "d6 3-4", (a.centerLeg ?? 0) + (s.centerLeg ?? 0), 50, 78) : "") +
    ctl("tr", "REAR", "2,12", a.rear + s.torso, 50, 91); // rear armor bleeds into torso structure

  const tripodNote = tripod
    ? `<p class="mdoll-legend">Legs: on a leg hit (2d6 = 5 or 9), roll 1d6 — 1-2 left, 3-4 center, 5-6 right.</p>`
    : "";
  return `<div class="bdoll-wrap"><svg class="bdoll" viewBox="-18 0 376 470" xmlns="http://www.w3.org/2000/svg">${seg}${dolls}${legend}</svg>${controls}</div>
  <p class="mdoll-legend">Armor (circles) over Structure (squares) · set damage per part — lower the number to heal</p>${tripodNote}`;
}

/** Armor/structure key swatch (shared by the biped and quad dolls). */
const dollLegend = (): string =>
  `${armorPip(dollArmorShape, 6, 456, 4.5)}<text class="bdoll-lbl" x="15" y="459" text-anchor="start">armor</text>` +
  `<rect class="bpip struct" x="62" y="451" width="9" height="9"/><text class="bdoll-lbl" x="76" y="459" text-anchor="start">structure</text>`;

/** True for Quad and QuadVee 'Mechs (top-down four-leg doll). */
export function isQuadDoll(card: OverrideCard): boolean {
  return /quad/i.test(card.config); // "Quad" and "QuadVee"
}

/**
 * Top-down doll for QUADS / QuadVees: a central body with a head at the front,
 * four legs at the corners, and the rear box at the back. The card stores the
 * front legs in the arm slots and the rear legs in the leg slots, so the area
 * codes (la/ra = front, ll/rl = rear) and hit numbers match a biped — only the
 * labels change (front legs take arm hits 3-4 / 10-11, rear legs 5 / 9).
 */
export function quadDoll(card: OverrideCard): string {
  dollArmorShape = armorShape(card.armorType);
  const a = card.armor;
  const s = card.structure;
  // Symmetric about the viewBox centre (x = 170). Legs touch the body so they
  // read as connected; each location's dropdown sits BELOW its pips (like the
  // biped) so armor + structure stay visible.
  const seg =
    // Head + visor + neck (front)
    rr(141, 14, 58, 46, 9) +
    `<rect x="158" y="22" width="24" height="8" rx="2" fill="${DARK}"/>` +
    rr(159, 56, 22, 30, 6) +
    // Body (torso)
    rr(106, 82, 128, 270, 18) +
    // Four legs at the corners, touching the body: front L / R, rear L / R
    rr(42, 96, 64, 128, 16) + rr(234, 96, 64, 128, 16) +
    rr(42, 246, 64, 128, 16) + rr(234, 246, 64, 128, 16) +
    // Rear box (back)
    rr(140, 354, 60, 30, 7, "#e7e7e1");

  const dolls =
    loc("hd", [147, 40, 46, 9], [147, 50, 46, 8], a.head, s.head) +
    loc("la", [46, 102, 56, 46], [46, 152, 56, 30], a.leftArm, s.leftArm) +
    loc("ra", [238, 102, 56, 46], [238, 152, 56, 30], a.rightArm, s.rightArm) +
    loc("ct", [112, 90, 116, 84], [112, 224, 116, 110], a.torso, s.torso) +
    loc("ll", [46, 252, 56, 46], [46, 302, 56, 30], a.leftLeg, s.leftLeg) +
    loc("rl", [238, 252, 56, 46], [238, 302, 56, 30], a.rightLeg, s.rightLeg) +
    loc("tr", [146, 358, 48, 22], [0, 0, 0, 0], a.rear, 0);

  const controls =
    ctl("hd", "HEAD", "12", a.head + s.head, 50, 4) +
    ctl("la", "L FRONT", "10,11", a.leftArm + s.leftArm, 24, 45) +
    ctl("ra", "R FRONT", "3,4", a.rightArm + s.rightArm, 76, 45) +
    ctl("ct", "TORSO", "6,7,8", a.torso + s.torso, 50, 43) +
    ctl("ll", "L REAR", "9", a.leftLeg + s.leftLeg, 24, 76) +
    ctl("rl", "R REAR", "5", a.rightLeg + s.rightLeg, 76, 76) +
    ctl("tr", "REAR", "2,12", a.rear + s.torso, 50, 86); // rear armor bleeds into torso structure

  return `<div class="bdoll-wrap"><svg class="bdoll" viewBox="-18 0 376 470" xmlns="http://www.w3.org/2000/svg">${seg}${dolls}${dollLegend()}</svg>${controls}</div>
  <p class="mdoll-legend">Armor (circles) over Structure (squares) · set damage per part — lower the number to heal</p>
  <p class="mdoll-legend">Quad: front legs take arm hits (3-4 / 10-11), rear legs take leg hits (5 / 9).</p>`;
}

/**
 * Top-down doll for AEROSPACE / Conventional fighters: a fighter silhouette with
 * armor circles per facing (nose / wings / aft) over a single airframe-wide SI
 * track (squares) down the fuselage. Uses the same `.mloc {area}` + dropdown
 * contract as the 'Mech dolls, so play-mode damage tracking works unchanged
 * (areas nose/lw/rw/aft carry armor; si carries the structure track).
 */
export function fighterDoll(card: FighterCard): string {
  dollArmorShape = armorShape(card.armorType);
  const a = card.armor;
  const si = card.structure;
  const seg =
    // Nose cone + canopy
    poly([[170, 14], [132, 108], [208, 108]]) +
    `<rect x="158" y="62" width="24" height="30" rx="6" fill="${DARK}"/>` +
    // Fuselage
    rr(140, 100, 60, 250, 14) +
    // Swept wings (left / right)
    poly([[140, 150], [22, 242], [80, 262], [140, 214]]) +
    poly([[200, 150], [318, 242], [260, 262], [200, 214]]) +
    // Tail fins (swept back, symmetric about x=170)
    poly([[142, 298], [96, 362], [142, 340]]) +
    poly([[198, 298], [244, 362], [198, 340]]) +
    // Aft / engines + exhaust
    rr(146, 338, 48, 54, 10) +
    `<rect x="150" y="386" width="40" height="10" rx="3" fill="${DARK}"/>`;

  const dolls =
    loc("nose", [142, 64, 56, 38], [0, 0, 0, 0], a.nose, 0) +
    loc("lw", [54, 196, 74, 34], [0, 0, 0, 0], a.leftWing, 0) +
    loc("rw", [212, 196, 74, 34], [0, 0, 0, 0], a.rightWing, 0) +
    loc("si", [0, 0, 0, 0], [146, 130, 48, 58], 0, si) +
    loc("aft", [150, 344, 40, 30], [0, 0, 0, 0], a.aft, 0);

  const controls =
    ctl("nose", "NOSE", "6,7,8", a.nose, 50, 7) +
    ctl("lw", "L WING", "9,10,11", a.leftWing, 12, 42) +
    ctl("rw", "R WING", "3,4,5", a.rightWing, 88, 42) +
    ctl("si", "SI", "", si, 50, 47) +
    ctl("aft", "AFT", "2,12", a.aft, 50, 90);

  return `<div class="bdoll-wrap"><svg class="bdoll" viewBox="-18 0 376 470" xmlns="http://www.w3.org/2000/svg">${seg}${dolls}${dollLegend()}</svg>${controls}</div>
  <p class="mdoll-legend">Armor (circles) per facing over a single SI track (squares, airframe-wide).</p>`;
}

/**
 * Top-down doll for combat VEHICLES / VTOLs: a hull with armor circles per facing
 * (front / sides / rear) flanking a central turret (or VTOL rotor), over a single
 * internal-structure track (squares). Uses the 'Mech dolls' `.mloc {area}` +
 * dropdown contract (areas front/left/right/rear/turret/rotor carry armor, is
 * carries structure), so play-mode tracking works unchanged. Turretless ground
 * vehicles drop the turret and shift the 5/9 rolls onto the sides.
 */
export function vehicleDoll(card: VehicleCard): string {
  dollArmorShape = armorShape(card.armorType);
  const a = card.armor;
  const s = card.structure;
  const vtol = card.hasRotor;
  const turreted = !vtol && a.turret !== undefined;
  const turretless = !vtol && a.turret === undefined;
  const rightHits = turretless ? "3,4,5" : "3,4";
  const leftHits = turretless ? "9,10,11" : "10,11";

  const centre = vtol
    ? `<ellipse cx="170" cy="206" rx="118" ry="15" fill="${FILL}" stroke="${STROKE}" stroke-width="1.6"/>` +
      `<circle cx="170" cy="206" r="30" fill="${FILL}" stroke="${STROKE}" stroke-width="1.6"/>`
    : turreted
      ? `<rect x="164" y="120" width="12" height="92" rx="3" fill="${DARK}"/>` + // gun barrel
        `<circle cx="170" cy="208" r="48" fill="${FILL}" stroke="${STROKE}" stroke-width="1.6"/>`
      : "";
  const seg =
    // Hull + side treads
    rr(86, 116, 168, 252, 16) +
    rr(76, 126, 16, 232, 6, DARK) + rr(248, 126, 16, 232, 6, DARK) +
    centre;

  const centreLoc = vtol
    ? loc("rotor", [150, 192, 40, 28], [0, 0, 0, 0], a.rotor ?? 0, 0)
    : turreted
      ? loc("turret", [142, 188, 56, 42], [0, 0, 0, 0], a.turret ?? 0, 0)
      : "";
  const dolls =
    loc("front", [104, 122, 132, 26], [0, 0, 0, 0], a.front, 0) +
    loc("left", [94, 170, 24, 118], [0, 0, 0, 0], a.left, 0) +
    loc("right", [222, 170, 24, 118], [0, 0, 0, 0], a.right, 0) +
    centreLoc +
    loc("is", [0, 0, 0, 0], [122, 262, 96, 22], 0, s) +
    loc("rear", [104, 340, 132, 24], [0, 0, 0, 0], a.rear, 0);

  const centreCtl = vtol
    ? ctl("rotor", "ROTOR", "5,9", a.rotor ?? 0, 50, 35)
    : turreted
      ? ctl("turret", "TURRET", "5,9", a.turret ?? 0, 50, 35)
      : "";
  const controls =
    ctl("front", "FRONT", "6,7,8", a.front, 50, 9) +
    ctl("left", "L SIDE", leftHits, a.left, 10, 44) +
    ctl("right", "R SIDE", rightHits, a.right, 90, 44) +
    centreCtl +
    ctl("is", "IS", "", s, 50, 66) +
    ctl("rear", "REAR", "", a.rear, 50, 91);

  return `<div class="bdoll-wrap"><svg class="bdoll" viewBox="-18 0 376 470" xmlns="http://www.w3.org/2000/svg">${seg}${dolls}${dollLegend()}</svg>${controls}</div>
  <p class="mdoll-legend">Armor (circles) per facing over a single structure track (squares) · TAC (crit) on 2 &amp; 12.</p>`;
}

/**
 * Doll for PROTOMECHS: a compact biped silhouette with head, two arms, torso, a
 * SINGLE legs block, and an optional torso Main Gun pod. Same `.mloc {area}` +
 * dropdown contract as the other dolls (areas hd/la/ra/ct/lg/mg). Hit table
 * mirrors the 'Mech's except a roll of 3 or 11 is a MISS (struck through).
 */
export function protoDoll(card: ProtoMechCard): string {
  dollArmorShape = armorShape(card.armorType);
  const a = card.armor;
  const s = card.structure;
  const mg = card.hasMainGun;
  const miss = (n: number) => `<s class="loc-miss">${n}</s>`;
  const seg =
    // Head + visor + neck
    rr(146, 14, 48, 44, 9) +
    `<rect x="158" y="21" width="24" height="7" rx="2" fill="${DARK}"/>` +
    rr(160, 56, 20, 10, 3) +
    // Shoulders
    poly([[80, 78], [126, 64], [126, 100], [88, 110]]) +
    poly([[260, 78], [214, 64], [214, 100], [252, 110]]) +
    // Torso (single block: armor over structure)
    rr(124, 64, 92, 92, 12) +
    // Arms (upper + lower)
    rr(82, 98, 34, 50, 8) + rr(80, 150, 34, 52, 8) +
    rr(224, 98, 34, 50, 8) + rr(226, 150, 34, 52, 8) +
    // Optional torso Main Gun: left outboard pod + barrel
    (mg ? rr(34, 92, 42, 76, 10) + `<rect x="50" y="74" width="10" height="22" rx="2" fill="${DARK}"/>` : "") +
    // Waist + single legs block + foot
    rr(146, 156, 48, 20, 6) +
    rr(128, 174, 84, 106, 14) +
    rr(118, 280, 104, 20, 6);

  const dolls =
    loc("hd", [150, 40, 40, 8], [150, 49, 40, 7], a.head, s.head) +
    loc("la", [84, 102, 30, 42], [82, 152, 30, 46], a.leftArm, s.leftArm) +
    loc("ra", [226, 102, 30, 42], [228, 152, 30, 46], a.rightArm, s.rightArm) +
    loc("ct", [130, 70, 80, 30], [130, 104, 80, 28], a.torso, s.torso) +
    loc("lg", [136, 182, 68, 42], [136, 226, 68, 48], a.legs, s.legs) +
    (mg ? loc("mg", [40, 98, 30, 30], [40, 130, 30, 30], a.mainGun ?? 0, s.mainGun ?? 0) : "");

  const controls =
    ctl("hd", "HEAD", "12", a.head + s.head, 50, 3) +
    ctl("la", "L ARM", `10,${miss(11)}`, a.leftArm + s.leftArm, 16, 30) +
    ctl("ra", "R ARM", `${miss(3)},4`, a.rightArm + s.rightArm, 84, 30) +
    ctl("ct", "TORSO", "6,7,8", a.torso + s.torso, 50, 34) +
    ctl("lg", "LEGS", "5,9", a.legs + s.legs, 50, 72) +
    (mg ? ctl("mg", "M GUN", "2", (a.mainGun ?? 0) + (s.mainGun ?? 0), 7, 33) : "");

  return `<div class="bdoll-wrap"><svg class="bdoll" viewBox="-18 0 376 470" xmlns="http://www.w3.org/2000/svg">${seg}${dolls}${dollLegend()}</svg>${controls}</div>
  <p class="mdoll-legend">Armor (circles) over Structure (squares) · single Legs location · <s class="loc-miss">3</s>/<s class="loc-miss">11</s> = miss.</p>`;
}

/**
 * Doll for DropShips (Aerodyne or Spheroid hull). Armor runs into the hundreds,
 * so each arc shows a NUMERIC value (not pips) placed on the hull silhouette,
 * with SI in the centre. Hit numbers follow the fighter table (Nose 6-8, R-Side
 * 3-5, L-Side 9-11, Aft 2 & 12). Visual only — no per-point damage tracking.
 */
export function dropshipDoll(card: DropshipCard): string {
  dollArmorShape = armorShape(card.armorType);
  const a = card.armor;
  const aero = /aero/i.test(card.motionLabel);
  const arc = (x: number, y: number, label: string, hits: string, val: number): string =>
    `<text class="bdoll-lbl" x="${x}" y="${y}">${label}</text>` +
    `<text class="bdoll-hit" x="${x}" y="${y + 10}">${hits}</text>` +
    `<text class="bdoll-num" x="${x}" y="${y + 30}">${val}</text>`;

  const seg = aero
    ? // Aerodyne: winged lifting body
      poly([[170, 16], [120, 120], [220, 120]]) +
      rr(118, 114, 104, 254, 28) +
      poly([[120, 178], [14, 300], [80, 322], [120, 262]]) +
      poly([[220, 178], [326, 300], [260, 322], [220, 262]]) +
      rr(126, 360, 88, 30, 8) +
      `<rect x="136" y="386" width="16" height="14" rx="2" fill="${DARK}"/><rect x="162" y="386" width="16" height="14" rx="2" fill="${DARK}"/><rect x="188" y="386" width="16" height="14" rx="2" fill="${DARK}"/>`
    : // Spheroid: egg body on landing legs
      rr(120, 350, 14, 44, 4, DARK) + rr(163, 356, 14, 44, 4, DARK) + rr(206, 350, 14, 44, 4, DARK) +
      `<ellipse cx="170" cy="206" rx="94" ry="152" fill="${FILL}" stroke="${STROKE}" stroke-width="1.6"/>` +
      `<path d="M92,150 Q170,118 248,150" fill="none" stroke="${STROKE}" stroke-width="1.2"/>` +
      `<path d="M86,262 Q170,290 254,262" fill="none" stroke="${STROKE}" stroke-width="1.2"/>` +
      `<rect x="134" y="96" width="14" height="9" rx="2" fill="${DARK}"/><rect x="156" y="90" width="14" height="9" rx="2" fill="${DARK}"/><rect x="192" y="96" width="14" height="9" rx="2" fill="${DARK}"/>`;

  const labels = aero
    ? arc(170, 60, "NOSE", "6,7,8", a.nose) +
      arc(56, 248, "L SIDE", "9,10,11", a.leftSide) +
      arc(284, 248, "R SIDE", "3,4,5", a.rightSide) +
      `<text class="bdoll-lbl" x="170" y="196">SI</text><text class="bdoll-num" x="170" y="218">${card.structure}</text>` +
      arc(170, 326, "AFT", "2,12", a.aft)
    : arc(170, 122, "NOSE", "6,7,8", a.nose) +
      arc(112, 214, "L SIDE", "9,10,11", a.leftSide) +
      arc(228, 214, "R SIDE", "3,4,5", a.rightSide) +
      `<text class="bdoll-lbl" x="170" y="170">SI</text><text class="bdoll-num" x="170" y="192">${card.structure}</text>` +
      arc(170, 300, "AFT", "2,12", a.aft);

  return `<div class="bdoll-wrap"><svg class="bdoll" viewBox="-18 0 376 470" xmlns="http://www.w3.org/2000/svg">${seg}${labels}</svg></div>
  <p class="mdoll-legend">${aero ? "Aerodyne" : "Spheroid"} DropShip — armor per arc (TW ÷ 4) over SI · hit numbers in parentheses.</p>`;
}
