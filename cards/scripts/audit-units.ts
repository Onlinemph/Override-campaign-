/**
 * audit-units.ts
 *
 * Bulk-convert EVERY MegaMek unit file under public/units and compile the
 * results into a triage report, so the "big problems" surface at a glance.
 *
 * For each .mtf/.blk file it runs the real `convertAny` and classifies the
 * outcome into one of:
 *   - ok          converted cleanly, no warnings
 *   - warning     converted but the card carries warnings (e.g. a weapon was
 *                 missing from the TW damage table) or looks suspicious
 *                 (converted with zero weapons AND zero equipment)
 *   - unsupported a recognised-but-not-yet-built unit type (Dropship, Proto, …)
 *   - error       a parse/convert failure (the genuinely broken files)
 *
 * It then aggregates the noise into actionable buckets — unknown weapons by
 * frequency, error templates by frequency, unsupported types by frequency, and
 * a per-category breakdown — and writes:
 *
 *   audit-report.json   full structured data (counts + every non-ok file)
 *   audit-report.md     human-readable summary of the biggest problems
 *
 * Usage:
 *   npm run audit                       # defaults to public/units
 *   npx tsx scripts/audit-units.ts [unitsDir] [outBaseName]
 *
 * Requires the units to be extracted first (npm run extract-units).
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { convertAny, ParseError } from "../src/core/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const unitsDir = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(root, "public", "units");
const outBase = process.argv[3] ?? join(root, "audit-report");

if (!existsSync(unitsDir)) {
  console.error(`Units directory not found: ${unitsDir}\nRun \`npm run extract-units\` first.`);
  process.exit(1);
}

type Status = "ok" | "warning" | "unsupported" | "error";

interface FileResult {
  path: string;
  category: string;
  format: "mtf" | "blk";
  status: Status;
  /** Converted unit kind (mech/vehicle/fighter/battlearmor), when it converted. */
  kind?: string;
  /** Human messages: warning strings, the error message, or the unsupported type. */
  messages: string[];
}

/** Recursively collect every .mtf/.blk path under a directory. */
function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else {
      const ext = extname(entry).toLowerCase();
      if (ext === ".mtf" || ext === ".blk") out.push(full);
    }
  }
  return out;
}

/**
 * Collapse a message into a template so like errors group together: strip the
 * leading "<filename>.mtf:" prefix (ParseError prepends it) and blank out any
 * quoted strings and numbers.
 */
function templ(msg: string): string {
  return msg
    .replace(/^.*?\.(mtf|blk):\s*/i, "")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/-?\d+(\.\d+)?/g, "#")
    .trim();
}

/** Pull the missing-weapon name out of a TW-table warning, if that's what it is. */
function unknownWeaponName(warning: string): string | null {
  const m = warning.match(/weapon not in TW damage table:\s*"([^"]+)"/i);
  return m ? m[1]! : null;
}

const files = collect(unitsDir).sort();
console.log(`Auditing ${files.length.toLocaleString()} unit files under ${relative(root, unitsDir) || unitsDir}…`);

const results: FileResult[] = [];
const totals: Record<Status, number> = { ok: 0, warning: 0, unsupported: 0, error: 0 };
const byCategory = new Map<string, Record<Status, number>>();
const byKind = new Map<string, number>();
const unknownWeapons = new Map<string, { count: number; examples: string[] }>();
const errorTemplates = new Map<string, { count: number; examples: { path: string; message: string }[] }>();
const unsupportedTypes = new Map<string, { count: number; examples: string[] }>();

function bump(map: Map<string, { count: number; examples: string[] }>, key: string, example: string): void {
  const e = map.get(key) ?? { count: 0, examples: [] };
  e.count += 1;
  if (e.examples.length < 5) e.examples.push(example);
  map.set(key, e);
}

for (const full of files) {
  const path = relative(unitsDir, full);
  const category = path.split(/[\\/]/)[0] ?? "Other";
  const format: "mtf" | "blk" = extname(full).toLowerCase() === ".mtf" ? "mtf" : "blk";
  const rec: FileResult = { path, category, format, status: "ok", messages: [] };

  try {
    const text = readFileSync(full, "utf8");
    const result = convertAny(text, basename(full));
    rec.kind = result.kind;
    byKind.set(result.kind, (byKind.get(result.kind) ?? 0) + 1);

    const warnings = result.card.warnings ?? [];
    // A converted unit with no firepower at all is usually a parse miss worth a
    // look. Count weapons across every card shape (BA `firepower`, infantry
    // `fieldGuns` + small arms), so legit unarmed-but-modeled units don't flag.
    const card = result.card as Record<string, unknown>;
    const len = (k: string) => (Array.isArray(card[k]) ? (card[k] as unknown[]).length : 0);
    const armed =
      len("weapons") + len("equipment") + len("firepower") + len("fieldGuns") > 0 ||
      result.kind === "infantry"; // infantry always carry small arms (not yet scored)
    const noFirepower = !armed;

    if (warnings.length > 0 || noFirepower) {
      rec.status = "warning";
      rec.messages = [...warnings];
      if (noFirepower) rec.messages.push("converted with no weapons or equipment");
      for (const w of warnings) {
        const name = unknownWeaponName(w);
        if (name) bump(unknownWeapons, name, path);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isUnsupported = err instanceof ParseError && /unsupported BLK unit type/i.test(message);
    if (isUnsupported) {
      rec.status = "unsupported";
      const type = message.match(/unit type\s*"([^"]+)"/i)?.[1] ?? "unknown";
      rec.messages = [type];
      bump(unsupportedTypes, type, path);
    } else {
      rec.status = "error";
      rec.messages = [message];
      const e = errorTemplates.get(templ(message)) ?? { count: 0, examples: [] };
      e.count += 1;
      if (e.examples.length < 5) e.examples.push({ path, message });
      errorTemplates.set(templ(message), e);
    }
  }

  totals[rec.status] += 1;
  const cat = byCategory.get(category) ?? { ok: 0, warning: 0, unsupported: 0, error: 0 };
  cat[rec.status] += 1;
  byCategory.set(category, cat);
  results.push(rec);
}

// --- Aggregate into sorted, capped buckets for the report. -------------------
const bySize = <T extends { count: number }>(a: [string, T], b: [string, T]) => b[1].count - a[1].count;

const unknownWeaponList = [...unknownWeapons.entries()].sort(bySize).map(([name, e]) => ({ name, ...e }));
const errorList = [...errorTemplates.entries()].sort(bySize).map(([signature, e]) => ({ signature, ...e }));
const unsupportedList = [...unsupportedTypes.entries()].sort(bySize).map(([type, e]) => ({ type, ...e }));
const categoryList = [...byCategory.entries()]
  .map(([category, c]) => ({ category, total: c.ok + c.warning + c.unsupported + c.error, ...c }))
  .sort((a, b) => b.total - a.total);

const report = {
  generatedAt: new Date().toISOString(),
  unitsDir: relative(root, unitsDir) || unitsDir,
  totalFiles: files.length,
  totals,
  byKind: Object.fromEntries([...byKind.entries()].sort((a, b) => b[1] - a[1])),
  byCategory: categoryList,
  unsupportedTypes: unsupportedList,
  errorTemplates: errorList,
  unknownWeapons: unknownWeaponList,
  // Keep the JSON usable: only the files that need attention, not the OK ones.
  problemFiles: results.filter((r) => r.status !== "ok"),
};

writeFileSync(`${outBase}.json`, JSON.stringify(report, null, 2) + "\n", "utf8");

// --- Markdown summary --------------------------------------------------------
const pct = (n: number) => `${((n / files.length) * 100).toFixed(1)}%`;
const md: string[] = [];
md.push(`# MegaMek conversion audit`);
md.push("");
md.push(`Generated ${report.generatedAt} · **${files.length.toLocaleString()}** unit files.`);
md.push("");
md.push(`| Status | Count | Share |`);
md.push(`| --- | ---: | ---: |`);
md.push(`| ✅ ok | ${totals.ok.toLocaleString()} | ${pct(totals.ok)} |`);
md.push(`| ⚠️ warning | ${totals.warning.toLocaleString()} | ${pct(totals.warning)} |`);
md.push(`| 🚧 unsupported | ${totals.unsupported.toLocaleString()} | ${pct(totals.unsupported)} |`);
md.push(`| ❌ error | ${totals.error.toLocaleString()} | ${pct(totals.error)} |`);
md.push("");

md.push(`## By category`);
md.push("");
md.push(`| Category | Total | ✅ | ⚠️ | 🚧 | ❌ |`);
md.push(`| --- | ---: | ---: | ---: | ---: | ---: |`);
for (const c of categoryList) {
  md.push(`| ${c.category} | ${c.total.toLocaleString()} | ${c.ok} | ${c.warning} | ${c.unsupported} | ${c.error} |`);
}
md.push("");

md.push(`## Errors (genuinely broken — fix these)`);
md.push("");
if (errorList.length === 0) {
  md.push(`_None._`);
} else {
  md.push(`| # | Error template | Example |`);
  md.push(`| ---: | --- | --- |`);
  for (const e of errorList.slice(0, 40)) {
    md.push(`| ${e.count} | ${e.signature.replace(/\|/g, "\\|")} | \`${e.examples[0]?.path ?? ""}\` |`);
  }
}
md.push("");

md.push(`## Unsupported unit types (not built yet)`);
md.push("");
if (unsupportedList.length === 0) {
  md.push(`_None._`);
} else {
  md.push(`| # | Type | Example |`);
  md.push(`| ---: | --- | --- |`);
  for (const u of unsupportedList) {
    md.push(`| ${u.count} | ${u.type} | \`${u.examples[0] ?? ""}\` |`);
  }
}
md.push("");

md.push(`## Missing weapons (most common — add these to the TW table first)`);
md.push("");
if (unknownWeaponList.length === 0) {
  md.push(`_None._`);
} else {
  md.push(`Top ${Math.min(60, unknownWeaponList.length)} of ${unknownWeaponList.length} distinct unknown weapons.`);
  md.push("");
  md.push(`| # | Weapon | Example |`);
  md.push(`| ---: | --- | --- |`);
  for (const w of unknownWeaponList.slice(0, 60)) {
    md.push(`| ${w.count} | ${w.name.replace(/\|/g, "\\|")} | \`${w.examples[0] ?? ""}\` |`);
  }
}
md.push("");

writeFileSync(`${outBase}.md`, md.join("\n"), "utf8");

// --- Console summary ---------------------------------------------------------
console.log("");
console.log(`  ✅ ok          ${totals.ok.toLocaleString().padStart(6)}  (${pct(totals.ok)})`);
console.log(`  ⚠️  warning     ${totals.warning.toLocaleString().padStart(6)}  (${pct(totals.warning)})`);
console.log(`  🚧 unsupported ${totals.unsupported.toLocaleString().padStart(6)}  (${pct(totals.unsupported)})`);
console.log(`  ❌ error       ${totals.error.toLocaleString().padStart(6)}  (${pct(totals.error)})`);
console.log("");
console.log(`  ${errorList.length} distinct error templates · ${unsupportedList.length} unsupported types · ${unknownWeaponList.length} distinct missing weapons`);
console.log("");
console.log(`Wrote ${relative(root, `${outBase}.json`)} and ${relative(root, `${outBase}.md`)}`);
