/**
 * Build public/role-index.json — a { key -> role } lookup (Sniper, Brawler,
 * Skirmisher, Juggernaut, Missile Boat, Scout, Striker, Ambusher, Dogfighter, …)
 * so the force-analytics panel can break a force down by battlefield role.
 *
 * Source: the MUL export (data/mul-units.txt). "Role" is column 16 (0-indexed
 * 15), before any fluff fields, so it's safe to read by split("|"). Keyed by the
 * normalized filename base AND by "Chassis Model" name, same scheme as the BV /
 * quirk indexes. "None" / "Undetermined" roles are skipped (not meaningful).
 *
 * Usage: node scripts/build-role-index.mjs [path-to-mul-export.txt]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2] ?? join(root, "data", "mul-units.txt");
const out = join(root, "public", "role-index.json");

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const base = (p) => (p.replace(/\\/g, "/").split("/").pop() ?? "").replace(/\.(mtf|blk)$/i, "");
const SKIP = new Set(["none", "undetermined", ""]);

const lines = readFileSync(src, "utf8").split("\n");
/** @type {Record<string, string>} */
const map = {};
let rows = 0;
for (let i = 1; i < lines.length; i++) {
  const f = lines[i].split("|");
  if (f.length < 16) continue;
  const role = (f[15] ?? "").trim();
  if (SKIP.has(role.toLowerCase())) continue;
  rows++;
  const nameKey = norm(`${f[1]} ${f[2]}`);
  if (nameKey) map[nameKey] = role;
  const fileLoc = f[f.length - 2];
  if (fileLoc && /\.(mtf|blk)$/i.test(fileLoc)) map[norm(base(fileLoc))] = role;
}
writeFileSync(out, JSON.stringify(map));
console.log(`build-role-index: ${rows} units with a role -> ${Object.keys(map).length} keys -> ${out}`);
