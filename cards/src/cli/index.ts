#!/usr/bin/env node
/**
 * mtf2override CLI — the Node I/O wrapper around the pure core.
 *
 * This is the ONLY layer allowed to touch the filesystem. It reads .mtf
 * (BattleMech) and .blk (Battle Armor) files, calls core (parse -> convert),
 * and writes JSON / CSV / a stdout summary.
 *
 * Usage:
 *   mtf2override <file-or-dir> [<file-or-dir> ...] [options]
 *
 * Options:
 *   --out <dir>   Output directory for per-unit JSON (default: current dir).
 *   --csv         Also write a flat CSV of all units (override-cards.csv).
 *   --no-json     Skip per-unit JSON output (summary/CSV only).
 *   -h, --help    Show this help.
 *
 * Inputs may be individual .mtf/.blk files or directories (scanned
 * non-recursively for them). Exits non-zero if any file fails to parse/convert.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import { convertAny, ParseError } from "../core/index.js";
import type { BattleArmorCard, DropshipCard, FighterCard, InfantryCard, OverrideCard, ProtoMechCard, VehicleCard } from "../core/index.js";

/** Input file extensions the tool understands. */
const SUPPORTED_EXTS = new Set([".mtf", ".blk"]);

interface CliOptions {
  inputs: string[];
  outDir: string;
  csv: boolean;
  json: boolean;
}

function printHelp(): void {
  process.stdout.write(
    [
      "mtf2override — convert MegaMek .mtf / .blk files to BattleTech: Override stats",
      "  (.mtf = BattleMechs; .blk = Battle Armor, with more unit types to come)",
      "",
      "Usage:",
      "  mtf2override <file-or-dir> [more ...] [options]",
      "",
      "Options:",
      "  --out <dir>   Output directory for per-unit JSON (default: current dir)",
      "  --csv         Also write a flat CSV of all units (override-cards.csv)",
      "  --no-json     Skip per-unit JSON output",
      "  -h, --help    Show this help",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { inputs: [], outDir: process.cwd(), csv: false, json: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
        break;
      case "--csv":
        opts.csv = true;
        break;
      case "--no-json":
        opts.json = false;
        break;
      case "--out": {
        const dir = argv[++i];
        if (!dir) {
          process.stderr.write("error: --out requires a directory argument\n");
          process.exit(2);
        }
        opts.outDir = resolve(dir);
        break;
      }
      default:
        if (arg.startsWith("-")) {
          process.stderr.write(`error: unknown option "${arg}"\n`);
          process.exit(2);
        }
        opts.inputs.push(arg);
    }
  }
  return opts;
}

/** Expand inputs (files or directories) into a flat list of .mtf/.blk file paths. */
function collectInputFiles(inputs: string[]): string[] {
  const files: string[] = [];
  for (const input of inputs) {
    const path = resolve(input);
    let st;
    try {
      st = statSync(path);
    } catch {
      process.stderr.write(`error: no such file or directory: ${input}\n`);
      process.exit(2);
    }
    if (st.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (SUPPORTED_EXTS.has(extname(entry).toLowerCase())) files.push(join(path, entry));
      }
    } else if (SUPPORTED_EXTS.has(extname(path).toLowerCase())) {
      files.push(path);
    } else {
      process.stderr.write(`warning: skipping unsupported file (not .mtf/.blk): ${input}\n`);
    }
  }
  return files;
}

/** Filesystem-safe output name for a card's JSON file. */
function jsonFileName(card: { chassis: string; model: string }): string {
  const base = [card.chassis, card.model]
    .filter((s) => s !== "")
    .join("_")
    .replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${base}.override.json`;
}

function printSummary(card: OverrideCard): void {
  const lines: string[] = [];
  lines.push(`${card.name}  (${card.mass}t ${card.techBase})`);
  lines.push(`  Move ${card.move}   TMM ${card.tmm} (sprint ${card.tmmSprint}, jump ${card.tmmJump})`);
  const aCL = card.armor.centerLeg !== undefined ? `  center-leg ${card.armor.centerLeg}` : "";
  const sCL = card.structure.centerLeg !== undefined ? `  center-leg ${card.structure.centerLeg}` : "";
  lines.push(
    `  Armor  torso ${card.armor.torso}  rear ${card.armor.rear}  head ${card.armor.head}` +
      `  arms ${card.armor.leftArm}/${card.armor.rightArm}  legs ${card.armor.leftLeg}/${card.armor.rightLeg}${aCL}`,
  );
  lines.push(
    `  Structure  torso ${card.structure.torso}  head ${card.structure.head}` +
      `  arms ${card.structure.leftArm}/${card.structure.rightArm}` +
      `  legs ${card.structure.leftLeg}/${card.structure.rightLeg}${sCL}`,
  );
  lines.push(`  Heat dissipation ${card.heatDissipation}`);
  if (card.tics.length > 0) {
    lines.push("  TICs:");
    for (const t of card.tics) {
      const rear = t.rearMounted ? " (R)" : "";
      const flag = t.weapons.some((w) => w.unknown) ? "  [!] unknown weapon" : "";
      const rng = t.rangeText ? ` [${t.rangeText}]` : "";
      lines.push(`    - ${t.label}${rear} @ ${t.location}: dmg ${t.damageText}${rng}${flag}`);
    }
  }
  lines.push(`  Melee: Punch / Kick ${card.melee.punch} / ${card.melee.kick}`);
  if (card.equipment.length > 0) {
    lines.push("  Equipment:");
    for (const e of card.equipment) {
      const qty = e.count > 1 ? ` x${e.count}` : "";
      const loc = e.global ? "" : ` @ ${e.location}`;
      lines.push(`    - ${e.label}${loc}${qty}`);
    }
  }
  for (const warn of card.warnings) lines.push(`  ! ${warn}`);
  process.stdout.write(lines.join("\n") + "\n\n");
}

/** Print a Battle Armor card summary. Armor/TMM are mirrored from 'Mech rules. */
function printBASummary(card: BattleArmorCard): void {
  const lines: string[] = [];
  lines.push(`${card.name}  (Battle Armor, ${card.weightClass}, ${card.techBase})`);
  lines.push(
    `  Troopers ${card.troopers}   Move ${card.move}   TMM ${card.tmm} (jump ${card.tmmJump})` +
      `   Anti-'Mech: ${card.antiMech ? "yes" : "no"}`,
  );
  lines.push(`  Armor/trooper ${card.armor} (raw ${card.armorPerTrooper})  [mirrored from 'Mech rules]`);
  if (card.firepower.length > 0 || card.antiInfantryByTrooper.length > 0) {
    lines.push("  Firepower (squad damage by surviving troopers, full squad first):");
    for (const w of card.firepower) {
      const flag = w.unknown ? "  [!] unknown weapon" : "";
      const rng = w.rangeText ? ` [${w.rangeText}]` : "";
      // Descending: full squad -> lone survivor, matching the printed card.
      const byCount = [...w.byTrooper].reverse().join(" | ");
      lines.push(`    - ${w.label}${rng}: ${byCount}${flag}`);
    }
    if (card.antiInfantryByTrooper.length > 0) {
      const byCount = [...card.antiInfantryByTrooper].reverse().join(" | ");
      lines.push(`    - Anti-Infantry [PB]: ${byCount}`);
    }
  }
  if (card.equipment.length > 0) {
    lines.push("  Equipment:");
    for (const e of card.equipment) {
      const qty = e.count > 1 ? ` x${e.count}` : "";
      lines.push(`    - ${e.label}${qty}`);
    }
  }
  for (const warn of card.warnings) lines.push(`  ! ${warn}`);
  process.stdout.write(lines.join("\n") + "\n\n");
}

/** Print a Combat Vehicle card summary. Armor/TMM/structure are best-effort. */
function printVehicleSummary(card: VehicleCard): void {
  const lines: string[] = [];
  const kind = `${card.support ? "Support" : "Combat"} ${card.hasRotor ? "VTOL" : "Vehicle"}`;
  lines.push(`${card.name}  (${kind}, ${card.motionType}, ${card.tonnage}t ${card.techBase})`);
  lines.push(`  Move ${card.move}   TMM ${card.tmm} / ${card.tmm + 1}   Structure ~${card.structure}  [best-effort]`);
  const a = card.armor;
  lines.push(
    `  Armor  front ${a.front}  right ${a.right}  left ${a.left}  rear ${a.rear}` +
      (card.hasTurret ? `  turret ${a.turret}` : "") +
      (card.hasRotor ? `  rotor ${a.rotor}` : ""),
  );
  if (card.weapons.length > 0) {
    lines.push("  Weapons:");
    for (const w of card.weapons) {
      const flag = w.unknown ? "  [!] unknown weapon" : "";
      const rng = w.rangeText ? ` [${w.rangeText}]` : "";
      const ht = w.heat > 0 ? ` ht${w.heat}` : "";
      lines.push(`    - ${w.label} @ ${w.facing}: dmg ${w.damageText}${ht}${rng}${flag}`);
    }
  }
  if (card.equipment.length > 0) {
    lines.push("  Equipment:");
    for (const e of card.equipment) {
      const qty = e.count > 1 ? ` x${e.count}` : "";
      lines.push(`    - ${e.label} (${e.facing})${qty}`);
    }
  }
  for (const warn of card.warnings) lines.push(`  ! ${warn}`);
  process.stdout.write(lines.join("\n") + "\n\n");
}

function printFighterSummary(card: FighterCard): void {
  const lines: string[] = [];
  const kind = card.conventional ? "Conventional Fighter" : "Aerospace Fighter";
  lines.push(`${card.name}  (${kind}, ${card.motionType}, ${card.tonnage}t ${card.techBase})`);
  const sinks = card.conventional ? "" : `   Sinks ${card.sinks}`;
  lines.push(
    `  Thrust ${card.move}   TMM ${card.tmm}   DThr ${card.dthr}${sinks}   SI ~${card.structure}`,
  );
  const a = card.armor;
  lines.push(`  Armor  nose ${a.nose}  R-wing ${a.rightWing}  L-wing ${a.leftWing}  aft ${a.aft}`);
  if (card.weapons.length > 0) {
    lines.push("  Weapons:");
    for (const w of card.weapons) {
      const flag = w.unknown ? "  [!] unknown weapon" : "";
      const rng = w.rangeText ? ` [${w.rangeText}]` : "";
      const ht = w.heat > 0 ? ` ht${w.heat}` : "";
      lines.push(`    - ${w.label} @ ${w.facing}: dmg ${w.damageText}${ht}${rng}${flag}`);
    }
  }
  if (card.equipment.length > 0) {
    lines.push("  Equipment:");
    for (const e of card.equipment) {
      const qty = e.count > 1 ? ` x${e.count}` : "";
      lines.push(`    - ${e.label} (${e.facing})${qty}`);
    }
  }
  for (const warn of card.warnings) lines.push(`  ! ${warn}`);
  process.stdout.write(lines.join("\n") + "\n\n");
}

/** Print a Conventional Infantry card summary. Small-arms damage pending DFA calibration. */
function printInfantrySummary(card: InfantryCard): void {
  const lines: string[] = [];
  lines.push(`${card.name}  (Infantry, ${card.motionLabel}, ${card.techBase})`);
  lines.push(
    `  Troopers ${card.troopers} (${card.squadCount}×${card.squadSize})   Move ${card.move}   TMM ${card.tmmText}` +
      `   Anti-'Mech: ${card.antiMek ? "yes" : "no"}  [best-effort]`,
  );
  lines.push(
    `  Damage: ${card.damage.length ? card.damage.join(" · ") : "— (per-trooper value pending)"}` +
      (card.rangeText ? `   Range [${card.rangeText}]  (max ${card.primaryRangeHexes} hex)` : ""),
  );
  lines.push(
    `  Primary: ${card.primaryWeapon || "—"}` +
      (card.secondaryWeapon ? `   Secondary: ${card.secondaryWeapon}${card.secondaryCount ? ` x${card.secondaryCount}` : ""}` : ""),
  );
  // Damage recalculates as whole squads are eliminated.
  if (card.damageBreaks.length > 1) {
    const bands = card.damageBreaks
      .map((b) => `${b.from === b.to ? b.from : `${b.from}-${b.to}`}:${b.damage.join("·") || "—"}`)
      .join("   ");
    lines.push(`  By squads left: ${bands}`);
  }
  if (card.fieldGuns.length > 0) {
    lines.push("  Field Guns:");
    for (const g of card.fieldGuns) {
      const flag = g.unknown ? "  [!] unknown weapon" : "";
      const rng = g.rangeText ? ` [${g.rangeText}]` : "";
      const ht = g.heat > 0 ? ` ht${g.heat}` : "";
      lines.push(`    - ${g.label}: dmg ${g.damageText}${ht}${rng}${flag}`);
    }
  }
  for (const warn of card.warnings) lines.push(`  ! ${warn}`);
  process.stdout.write(lines.join("\n") + "\n\n");
}

/** Print a ProtoMech card summary. */
function printProtoSummary(card: ProtoMechCard): void {
  const lines: string[] = [];
  lines.push(`${card.name}  (ProtoMech, ${card.motionLabel}, ${card.tonnage}t ${card.techBase})`);
  lines.push(`  Move ${card.move}   TMM ${card.tmmText}`);
  const a = card.armor;
  const s = card.structure;
  const mg = (v: ProtoMechCard["armor"]) => (v.mainGun !== undefined ? `  main-gun ${v.mainGun}` : "");
  lines.push(`  Armor  head ${a.head}  torso ${a.torso}  arms ${a.leftArm}/${a.rightArm}  legs ${a.legs}${mg(a)}`);
  lines.push(`  Structure  head ${s.head}  torso ${s.torso}  arms ${s.leftArm}/${s.rightArm}  legs ${s.legs}${mg(s)}`);
  if (card.weapons.length > 0) {
    lines.push("  Weapons:");
    for (const w of card.weapons) {
      const flag = w.unknown ? "  [!] unknown weapon" : "";
      const rng = w.rangeText ? ` [${w.rangeText}]` : "";
      lines.push(`    - ${w.label} @ ${w.facing}: dmg ${w.damageText}  ht${w.heat}${rng}${flag}`);
    }
  }
  lines.push(`  Frenzy: ${card.frenzy}`);
  if (card.equipment.length > 0) {
    lines.push(`  Equipment: ${card.equipment.map((e) => `${e.label}${e.count > 1 ? ` x${e.count}` : ""}`).join(", ")}`);
  }
  for (const warn of card.warnings) lines.push(`  ! ${warn}`);
  process.stdout.write(lines.join("\n") + "\n\n");
}

/** Print a DropShip card summary (aerospace rules; SI from the BLK, best-effort). */
function printDropshipSummary(card: DropshipCard): void {
  const lines: string[] = [];
  lines.push(`${card.name}  (DropShip, ${card.motionLabel}, ${card.tonnage.toLocaleString()}t ${card.techBase})`);
  lines.push(
    `  Thrust ${card.move}   TMM ${card.tmm}   DThr ${card.dthr}   Sinks ${card.sinks}   SI ${card.structure}`,
  );
  const a = card.armor;
  lines.push(`  Armor  nose ${a.nose}  L-side ${a.leftSide}  R-side ${a.rightSide}  aft ${a.aft}`);
  if (card.bays.length > 0) {
    lines.push(`  Capacity: ${card.bays.map((b) => (b.tons ? `${b.label} ${b.size.toLocaleString()}t` : `${b.label} x${b.size}`)).join(", ")}`);
  }
  if (card.weapons.length > 0) {
    lines.push("  Weapons:");
    for (const w of card.weapons) {
      const flag = w.unknown ? "  [!] unknown weapon" : "";
      const rng = w.rangeText ? ` [${w.rangeText}]` : "";
      const ht = w.heat > 0 ? ` ht${w.heat}` : "";
      lines.push(`    - ${w.label} @ ${w.facing}: dmg ${w.damageText}${ht}${rng}${flag}`);
    }
  }
  if (card.equipment.length > 0) {
    lines.push("  Equipment:");
    for (const e of card.equipment) {
      const qty = e.count > 1 ? ` x${e.count}` : "";
      lines.push(`    - ${e.label} (${e.facing})${qty}`);
    }
  }
  for (const warn of card.warnings) lines.push(`  ! ${warn}`);
  process.stdout.write(lines.join("\n") + "\n\n");
}

/** Build a flat CSV (one row per unit) covering the scalar card fields. */
function toCsv(cards: OverrideCard[]): string {
  const header = [
    "chassis",
    "model",
    "mass",
    "techBase",
    "move",
    "walk",
    "run",
    "jump",
    "tmm",
    "tmmSprint",
    "tmmJump",
    "armorTorso",
    "armorRear",
    "armorHead",
    "armorLeftArm",
    "armorRightArm",
    "armorLeftLeg",
    "armorRightLeg",
    "structureTorso",
    "structureHead",
    "structureLeftArm",
    "structureRightArm",
    "structureLeftLeg",
    "structureRightLeg",
    "heatDissipation",
    "weaponCount",
  ];
  const esc = (v: string | number): string => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = cards.map((c) =>
    [
      c.chassis,
      c.model,
      c.mass,
      c.techBase,
      c.move,
      c.walkMove,
      c.runMove,
      c.jump,
      c.tmm,
      c.tmmSprint,
      c.tmmJump,
      c.armor.torso,
      c.armor.rear,
      c.armor.head,
      c.armor.leftArm,
      c.armor.rightArm,
      c.armor.leftLeg,
      c.armor.rightLeg,
      c.structure.torso,
      c.structure.head,
      c.structure.leftArm,
      c.structure.rightArm,
      c.structure.leftLeg,
      c.structure.rightLeg,
      c.heatDissipation,
      c.weapons.length,
    ]
      .map(esc)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n") + "\n";
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.inputs.length === 0) {
    printHelp();
    process.exit(opts.inputs.length === 0 ? 2 : 0);
  }

  const files = collectInputFiles(opts.inputs);
  if (files.length === 0) {
    process.stderr.write("error: no .mtf/.blk files found in the given inputs\n");
    process.exit(2);
  }

  if (opts.json || opts.csv) mkdirSync(opts.outDir, { recursive: true });

  const cards: OverrideCard[] = []; // 'Mech cards only (the CSV is 'Mech-shaped)
  let converted = 0;
  let failures = 0;

  for (const file of files) {
    try {
      const text = readFileSync(file, "utf8");
      const result = convertAny(text, basename(file));
      result.card.sourceFile = file;

      if (opts.json) {
        const outPath = join(opts.outDir, jsonFileName(result.card));
        writeFileSync(outPath, JSON.stringify(result.card, null, 2) + "\n", "utf8");
      }
      converted++;
      if (result.kind === "battlearmor") {
        printBASummary(result.card);
      } else if (result.kind === "vehicle") {
        printVehicleSummary(result.card);
      } else if (result.kind === "fighter") {
        printFighterSummary(result.card);
      } else if (result.kind === "infantry") {
        printInfantrySummary(result.card);
      } else if (result.kind === "protomech") {
        printProtoSummary(result.card);
      } else if (result.kind === "dropship") {
        printDropshipSummary(result.card);
      } else {
        cards.push(result.card);
        printSummary(result.card);
      }
    } catch (err) {
      failures++;
      if (err instanceof ParseError) {
        process.stderr.write(`PARSE ERROR ${err.message}\n`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`ERROR ${basename(file)}: ${msg}\n`);
      }
    }
  }

  if (opts.csv && cards.length > 0) {
    const csvPath = join(opts.outDir, "override-cards.csv");
    writeFileSync(csvPath, toCsv(cards), "utf8");
    process.stdout.write(`Wrote CSV: ${csvPath}\n`);
  }

  process.stdout.write(
    `Done: ${converted} converted, ${failures} failed${opts.json ? `, JSON in ${opts.outDir}` : ""}.\n`,
  );
  if (failures > 0) process.exit(1);
}

main();
