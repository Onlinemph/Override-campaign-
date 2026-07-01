/**
 * extract-units.mjs
 *
 * Pre-build step: extracts every .mtf/.blk file from public/units.zip into
 * public/units/ (served statically by Vite / gh-pages) and writes a compact
 * JSON search index to public/units-index.json (also served statically).
 *
 * Run:  node scripts/extract-units.mjs
 * Also called automatically as part of `build:web`.
 *
 * Output:
 *   public/units/<original path from zip>   — individual unit files
 *   public/units-index.json                 — [{name, path, category, era}]
 *
 * Both output locations are gitignored; they are regenerated each build. The
 * index is a STATIC asset (not a bundled import) so it survives the single-file
 * inlining step (scripts/inline.mjs deletes the hashed assets/ dir) and keeps a
 * stable URL across deploys — the browser fetches it from ./units-index.json.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, basename, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ZIP = join(ROOT, "public", "units.zip");
const OUT_DIR = join(ROOT, "public", "units");
const INDEX_FILE = join(ROOT, "public", "units-index.json");

if (!existsSync(ZIP)) {
  console.error(`units.zip not found at ${ZIP}`);
  process.exit(1);
}

// Clean and re-extract
if (existsSync(OUT_DIR)) {
  console.log("Cleaning previous extraction…");
  rmSync(OUT_DIR, { recursive: true, force: true });
}
mkdirSync(OUT_DIR, { recursive: true });

console.log("Extracting units.zip…");
const outEmpty = () => !existsSync(OUT_DIR) || readdirSync(OUT_DIR).length === 0;

// Fast path: the `unzip` CLI (Linux / macOS / CI). If it's missing — e.g. plain
// Windows PowerShell — fall back to a pure-Node extractor so `npm run setup`
// needs nothing beyond Node.
let usedCli = false;
try {
  // -q quiet, -n never overwrite (shouldn't matter after clean), extract into OUT_DIR
  execSync(`unzip -q -n "${ZIP}" "*.mtf" "*.blk" -d "${OUT_DIR}"`, { stdio: "inherit" });
  usedCli = true;
} catch {
  console.log("`unzip` not found — using the built-in Node extractor…");
}
if (!usedCli || outEmpty()) {
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(ZIP);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (!/\.(mtf|blk)$/i.test(entry.entryName)) continue;
    const dest = join(OUT_DIR, entry.entryName);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, entry.getData());
  }
}

// The zip has a top-level "Override Data/" folder; canonicalize so our URLs are
// rooted at /units/ without the "Override Data/" prefix. Pure Node — any OS.
const OVERRIDE_DATA = join(OUT_DIR, "Override Data");
if (existsSync(OVERRIDE_DATA)) {
  for (const entry of readdirSync(OVERRIDE_DATA)) {
    renameSync(join(OVERRIDE_DATA, entry), join(OUT_DIR, entry));
  }
  rmSync(OVERRIDE_DATA, { recursive: true, force: true });
}

// Walk the extracted tree and build the search index.
/** @type {Array<{name:string,path:string,category:string,era:string}>} */
const index = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else {
      const ext = extname(entry).toLowerCase();
      if (ext !== ".mtf" && ext !== ".blk") continue;
      const rel = relative(OUT_DIR, full); // e.g. "Mechs/3025/Atlas AS7-D.mtf"
      const parts = rel.split(/[\\/]/);
      const category = parts[0] ?? "Other";
      const era = parts.length >= 3 ? parts[1] : "";
      const name = basename(entry, extname(entry));
      index.push({ name, path: rel, category, era });
    }
  }
}

walk(OUT_DIR);

// Sort alphabetically by name for a predictable initial ordering.
index.sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(INDEX_FILE, JSON.stringify(index));
console.log(`Index written: ${index.length} units → ${INDEX_FILE}`);
