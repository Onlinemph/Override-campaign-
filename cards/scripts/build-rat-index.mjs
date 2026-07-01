/**
 * Build public/rat-index.json — MegaMek Random Assignment Tables distilled for
 * the weighted random force generator.
 *
 * Source: data/mul-rats.zip (MegaMek data/rat/ tree). Each .txt is one table:
 * '#'-comments, a title line (no comma), then `Unit Name,frequency` rows. The
 * path encodes era-source / (Inner Sphere|Clan) / faction / table.
 *
 * Unit names are resolved AT BUILD TIME against public/units-index.json (the
 * corpus); unresolved rows are dropped. Resolved units are deduped into a
 * `units` array and tables reference them by index + weight, keeping the file
 * compact.
 *
 * Output: { units:[{p,n}], sources:[{ name, factions:[{ name, side,
 *           tables:[{ name, type, weight, e:[[unitIdx, weight],…] }] }] }] }
 *
 * Usage: node scripts/build-rat-index.mjs
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const zip = join(root, "data", "mul-rats.zip");
const out = join(root, "public", "rat-index.json");

if (!existsSync(zip)) {
  console.error(`mul-rats.zip not found at ${zip}`);
  process.exit(1);
}

// Resolve RAT unit names against the corpus, tolerating "(Standard)" etc.
const strip = (s) =>
  s.toLowerCase().replace(/\s*\((standard|unofficial|[^)]*carriage[^)]*)\)/g, "").replace(/\s+/g, " ").trim();
const idx = JSON.parse(readFileSync(join(root, "public", "units-index.json"), "utf8"));
const byName = new Map();
for (const u of idx) {
  const k = strip(u.name);
  if (!byName.has(k)) byName.set(k, u);
}

// Deduped resolved-unit pool; tables reference these by index.
const units = [];
const unitIdx = new Map(); // corpus path -> index
function unitRef(name) {
  const u = byName.get(strip(name));
  if (!u) return -1;
  let i = unitIdx.get(u.path);
  if (i === undefined) {
    i = units.length;
    units.push({ p: u.path, n: u.name });
    unitIdx.set(u.path, i);
  }
  return i;
}

function classify(name) {
  const s = name.toLowerCase();
  const weight = /\bassault\b/.test(s)
    ? "Assault"
    : /\bheavy\b/.test(s)
      ? "Heavy"
      : /\bmedium\b/.test(s)
        ? "Medium"
        : /\blight\b/.test(s)
          ? "Light"
          : "";
  const type = /\bmek\b|\bmech\b/.test(s)
    ? "Mek"
    : /vehicle|tank/.test(s)
      ? "Vehicle"
      : /aero|fighter/.test(s)
        ? "Aerospace"
        : /battle ?armor/.test(s)
          ? "BattleArmor"
          : /infantry/.test(s)
            ? "Infantry"
            : /dropship/.test(s)
              ? "DropShip"
              : /proto/.test(s)
                ? "ProtoMek"
                : "";
  return { weight, type };
}

const tmp = mkdtempSync(join(tmpdir(), "rats-"));
try {
  execSync(`unzip -q -o "${zip}" -d "${tmp}"`, { stdio: "inherit" });
  const ratRoot = existsSync(join(tmp, "data", "rat")) ? join(tmp, "data", "rat") : tmp;

  // source name -> { faction name -> { side, tables: [...] } }
  const sources = new Map();
  let files = 0;
  let rows = 0;
  let resolved = 0;

  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".txt")) continue;
      files++;
      // Path: <source> / [Inner Sphere|Clan] / <faction> / [type] / [weight] / <table>.txt
      // The faction is the directory right after the source (and the side dir,
      // when present) — NOT the immediate parent dir (that's the type/weight).
      const parts = relative(ratRoot, full).split(/[\\/]/);
      const source = parts[0] ?? "Other";
      const hasSide = parts[1] === "Inner Sphere" || parts[1] === "Clan";
      const side = hasSide ? parts[1] : "";
      const faction = parts[hasSide ? 2 : 1] ?? "General";

      const lines = readFileSync(full, "utf8").split("\n");
      let title = entry.replace(/\.txt$/i, "");
      const e = [];
      for (const raw of lines) {
        const ln = raw.trim();
        if (!ln || ln.startsWith("#")) continue;
        const c = ln.lastIndexOf(",");
        if (c < 0) {
          title = ln; // the table's own name line
          continue;
        }
        const name = ln.slice(0, c).trim();
        const w = Number(ln.slice(c + 1));
        if (!name || !Number.isFinite(w) || w <= 0) continue;
        rows++;
        const ref = unitRef(name);
        if (ref < 0) continue;
        resolved++;
        e.push([ref, w]);
      }
      if (e.length === 0) continue;

      if (!sources.has(source)) sources.set(source, new Map());
      const factions = sources.get(source);
      if (!factions.has(faction)) factions.set(faction, { side, tables: [] });
      const { weight, type } = classify(title);
      factions.get(faction).tables.push({ name: title, type, weight, e });
    }
  };
  walk(ratRoot);

  const sourceList = [...sources]
    .map(([name, factions]) => ({
      name,
      factions: [...factions]
        .map(([fname, f]) => ({ name: fname, side: f.side, tables: f.tables.sort((a, b) => a.name.localeCompare(b.name)) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  writeFileSync(out, JSON.stringify({ units, sources: sourceList }));
  console.log(
    `build-rat-index: ${files} tables, ${rows} rows, ${resolved} resolved ` +
      `(${((100 * resolved) / rows).toFixed(1)}%), ${units.length} distinct units -> ${out}`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
