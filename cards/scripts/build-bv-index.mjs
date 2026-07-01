/**
 * Build public/bv-index.json — a { key -> Battle Value } lookup the web app
 * uses to show each unit's official BV (Total Warfare BV2) and total a force.
 *
 * Source: a Master Unit List export (pipe-delimited), `data/mul-units.txt` by
 * default. The columns we read are stable from the LEFT up to BV (col 17), and
 * the File Location is the second-to-last column (robust even when fluff text
 * contains stray "|"). We key every unit BOTH by its normalized filename base
 * (matches the MegaMek .mtf/.blk we ship — ~98% coverage) and by its normalized
 * "Chassis Model" name (fallback for pasted text with no filename).
 *
 * Usage: node scripts/build-bv-index.mjs [path-to-mul-export.txt]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2] ?? join(root, "data", "mul-units.txt");
const out = join(root, "public", "bv-index.json");

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const base = (p) => p.replace(/\\/g, "/").split("/").pop().replace(/\.(mtf|blk)$/i, "");

const lines = readFileSync(src, "utf8").split("\n");
/** @type {Record<string, number>} */
const map = {};
let rows = 0;
for (let i = 1; i < lines.length; i++) {
  const f = lines[i].split("|");
  if (f.length < 17) continue;
  const bv = Number(f[16]);
  if (!Number.isFinite(bv) || bv <= 0) continue;
  rows++;
  const nameKey = norm(`${f[1]} ${f[2]}`);
  if (nameKey) map[nameKey] = bv;
  const fileLoc = f[f.length - 2];
  if (fileLoc && /\.(mtf|blk)$/i.test(fileLoc)) map[norm(base(fileLoc))] = bv;
}
writeFileSync(out, JSON.stringify(map));
console.log(`build-bv-index: ${rows} units -> ${Object.keys(map).length} keys -> ${out}`);
