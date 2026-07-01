/**
 * Offline preview: render a converted card ('Mech or Battle Armor) to a
 * standalone HTML file using the REAL renderers (src/web/*-card.ts) and the
 * REAL stylesheet (src/web/style.css), so what you open matches the web app.
 *
 * Usage: npx tsx scripts/card-preview.ts [file.mtf|file.blk] [out.html]
 * Defaults to the Elemental [Laser] fixture -> card-preview.html.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { convertAny } from "../src/core/index.js";
import { renderBACard } from "../src/web/ba-card.js";
import { renderDropshipCard } from "../src/web/dropship-card.js";
import { renderFighterCard } from "../src/web/fighter-card.js";
import { renderInfantryCard } from "../src/web/infantry-card.js";
import { renderMechCard } from "../src/web/mech-card.js";
import { renderProtoCard } from "../src/web/proto-card.js";
import { renderVehicleCard } from "../src/web/vehicle-card.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const input = process.argv[2] ?? join(root, "tests/fixtures/Elemental Laser.blk");
const outPath = process.argv[3] ?? join(root, "card-preview.html");

const text = readFileSync(input, "utf8");
const result = convertAny(text, input);
const cardHtml =
  result.kind === "battlearmor"
    ? renderBACard(result.card)
    : result.kind === "vehicle"
      ? renderVehicleCard(result.card)
      : result.kind === "fighter"
        ? renderFighterCard(result.card)
        : result.kind === "infantry"
          ? renderInfantryCard(result.card)
          : result.kind === "protomech"
            ? renderProtoCard(result.card)
            : result.kind === "dropship"
              ? renderDropshipCard(result.card)
              : renderMechCard(result.card);

const css = readFileSync(join(root, "src/web/style.css"), "utf8");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Override card preview — ${result.card.name}</title>
<style>${css}</style></head>
<body><main id="app"><section class="output">${cardHtml}</section></main></body></html>`;

writeFileSync(outPath, html, "utf8");
process.stdout.write(`Wrote ${outPath}\n`);
