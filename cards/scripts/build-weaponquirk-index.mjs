/**
 * Build public/weaponquirk-index.json — per-weapon design quirks from the bundled
 * unit FILES (the MUL export only lists weapon-quirk *types*, not which weapon
 * carries them). MTF files have `weaponquirk:CODE:LOC:SLOT:WeaponName` lines; BLK
 * files list `CODE:LOC:SLOT:WeaponName` inside a <weaponQuirks> block.
 *
 * Output: { fileKey -> [[code, rawWeaponName], …] } (deduped), keyed by the
 * normalized filename base (lowercased, whitespace-collapsed) so it matches the
 * web app's bvKey(fileStem(path)) lookup, same scheme as the BV/quirk indexes.
 * Weapon-name cleanup + code→label happen in the web layer (it has the core's
 * normalizeWeaponName), so this stays a dependency-free file scan.
 *
 * Usage: node scripts/build-weaponquirk-index.mjs [units-dir]
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const unitsDir = process.argv[2] ?? join(root, "public", "units");
const out = join(root, "public", "weaponquirk-index.json");

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const baseKey = (file) => norm(file.replace(/\.(mtf|blk)$/i, ""));

/** Walk a directory tree, yielding every .mtf / .blk file path. */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(mtf|blk)$/i.test(name)) yield p;
  }
}

/** Pull "code:loc:slot:WeaponName" rows out of one file (MTF lines or a BLK block). */
function quirkRows(text) {
  const rows = [];
  const push = (rest) => {
    const parts = rest.split(":");
    if (parts.length < 4) return;
    const code = parts[0].trim();
    const weapon = parts.slice(3).join(":").trim(); // weapon names never contain ":"
    if (code && weapon) rows.push([code, weapon]);
  };
  const lines = text.split(/\r?\n/);
  let inBlk = false;
  for (const line of lines) {
    const m = /^weaponquirk:(.+)$/i.exec(line);
    if (m) {
      push(m[1]);
      continue;
    }
    if (/^<weaponQuirks>/i.test(line)) inBlk = true;
    else if (/^<\/weaponQuirks>/i.test(line)) inBlk = false;
    else if (inBlk && /^[a-z_]+:[^:]+:/i.test(line.trim())) push(line.trim());
  }
  return rows;
}

const map = {};
let files = 0;
for (const path of walk(unitsDir)) {
  const rows = quirkRows(readFileSync(path, "utf8"));
  if (rows.length === 0) continue;
  // Dedupe (code, weapon) pairs within the file.
  const seen = new Set();
  const uniq = [];
  for (const [c, w] of rows) {
    const k = `${c}|${w}`;
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push([c, w]);
    }
  }
  map[baseKey(path.split(/[\\/]/).pop())] = uniq;
  files++;
}

writeFileSync(out, JSON.stringify(map));
console.log(`build-weaponquirk-index: ${files} units with weapon quirks -> ${Object.keys(map).length} keys -> ${out}`);
