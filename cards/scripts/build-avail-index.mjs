/**
 * Build public/avail-index.json — the MUL faction × era availability used to
 * filter the unit browser / force builder to what a faction could field in an
 * era.
 *
 * Sources (both in data/):
 *   - mul-availability.csv  (faction_id,faction,era_id,era,unit_id,unit_name)
 *   - mul-units.txt         (the units export; MUL ID = col 1, File Location =
 *                            2nd-to-last col) — bridges MUL ID -> our filenames.
 *
 * Output: { factions:[{id,name}], eras:[{id,name}] (chronological),
 *           byFile:{ <filename stem>: mulId }, avail:{ <mulId>: { <factionId>:
 *           eraBitmask } } } where the era bit index follows the eras[] order.
 *
 * Usage: node scripts/build-avail-index.mjs [availability.csv] [units.txt]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const availSrc = process.argv[2] ?? join(root, "data", "mul-availability.csv");
const unitsSrc = process.argv[3] ?? join(root, "data", "mul-units.txt");
const out = join(root, "public", "avail-index.json");

// The data's era_ids aren't chronological; this is the timeline order.
const ERA_ORDER = [10, 11, 255, 256, 13, 247, 14, 15, 16, 257];

const stem = (p) => (p.replace(/\\/g, "/").split("/").pop() ?? "").replace(/\.(mtf|blk)$/i, "");
const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

// filename stem -> MUL ID (File Location is the 2nd-to-last field of the export).
const byFile = {};
for (const line of readFileSync(unitsSrc, "utf8").split("\n").slice(1)) {
  const f = line.split("|");
  if (f.length < 2) continue;
  const id = Number(f[0]);
  const loc = f[f.length - 2];
  if (Number.isFinite(id) && id > 0 && loc && /\.(mtf|blk)$/i.test(loc)) byFile[norm(stem(loc))] = id;
}

// avail[mulId][factionId] = era bitmask (bit i set => available in eras[i]).
const factions = new Map();
const eras = new Map();
const avail = {};
const lines = readFileSync(availSrc, "utf8").split("\n");
for (let i = 1; i < lines.length; i++) {
  const c = lines[i].split(","); // cols 0..4 are numeric/clean; only unit_name (last) may hold commas
  if (c.length < 6) continue;
  const factionId = Number(c[0]);
  const eraId = Number(c[2]);
  const unitId = Number(c[4]);
  if (![factionId, eraId, unitId].every(Number.isFinite)) continue;
  factions.set(factionId, c[1].trim());
  eras.set(eraId, c[3].trim());
  const bit = ERA_ORDER.indexOf(eraId);
  if (bit < 0) continue;
  (avail[unitId] ??= {})[factionId] = (avail[unitId][factionId] ?? 0) | (1 << bit);
}

const factionList = [...factions].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
const eraList = ERA_ORDER.filter((id) => eras.has(id)).map((id) => ({ id, name: eras.get(id) }));

writeFileSync(out, JSON.stringify({ factions: factionList, eras: eraList, byFile, avail }));
console.log(
  `build-avail-index: ${factionList.length} factions, ${eraList.length} eras, ` +
    `${Object.keys(avail).length} units, ${Object.keys(byFile).length} file keys -> ${out}`,
);
