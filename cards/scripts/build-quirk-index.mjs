/**
 * Build public/quirk-index.json — a { key -> {u:[unit quirks], w:[weapon quirks]} }
 * lookup so the web app can optionally show each unit's design quirks on the card.
 *
 * Source: the MUL export (data/mul-units.txt). "Unit Quirks" is column 28
 * (0-indexed 27) and "Weapon Quirks" is column 29 (28), both before any fluff
 * fields, so they're safe to read by split("|"). Keyed by normalized filename
 * base (matches the bundled units) AND by "Chassis Model" name (fallback for
 * pasted text) — same scheme as the BV index.
 *
 * Usage: node scripts/build-quirk-index.mjs [path-to-mul-export.txt]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2] ?? join(root, "data", "mul-units.txt");
const out = join(root, "public", "quirk-index.json");

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const base = (p) => (p.replace(/\\/g, "/").split("/").pop() ?? "").replace(/\.(mtf|blk)$/i, "");

const split = (s) => (s ?? "").split(";").map((x) => x.trim()).filter(Boolean);
const lines = readFileSync(src, "utf8").split("\n");
/** @type {Record<string, {u: string[], w: string[]}>} */
const map = {};
let rows = 0;
for (let i = 1; i < lines.length; i++) {
  const f = lines[i].split("|");
  if (f.length < 29) continue;
  const u = split(f[27]); // Unit Quirks
  const w = split(f[28]); // Weapon Quirks
  if (u.length === 0 && w.length === 0) continue;
  rows++;
  const val = { u, w };
  const nameKey = norm(`${f[1]} ${f[2]}`);
  if (nameKey) map[nameKey] = val;
  const fileLoc = f[f.length - 2];
  if (fileLoc && /\.(mtf|blk)$/i.test(fileLoc)) map[norm(base(fileLoc))] = val;
}
writeFileSync(out, JSON.stringify(map));
console.log(`build-quirk-index: ${rows} units with quirks -> ${Object.keys(map).length} keys -> ${out}`);
