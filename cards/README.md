# Override Card Builder

Turn MegaMek unit files into **BattleTech: Override** record cards, then play a
whole game from the browser — build a force, organize it into lances/stars,
track damage and heat, run Cinematic Initiative, and battle a friend online in
real time. Everything runs client-side; there is no server to host.

- **Live app:** a single static page (also installable as a PWA), published to
  GitHub Pages.
- **Library + CLI:** the same pure conversion engine (`src/core`) also ships as
  a Node package (`mtf2override`) with a batch CLI.

> **Supported unit types:** BattleMechs (`.mtf`), Battle Armor, Combat Vehicles
> & VTOLs, Aerospace / Conventional Fighters, ProtoMechs, Infantry, and
> DropShips (`.blk`). Every type reuses the shared weapon → damage / range /
> TIC engine; each adds its own armor diagram and hit table.

## What it does

### Convert & render cards
- Browse a **bundled unit library** (MegaMek `.mtf`/`.blk` data, ~45 MB,
  extracted into the build) — search by name, filter by faction/era.
- Paste/upload a file, or pick from the library, and get an Override record
  card rendered entirely in the browser.
- **TIC editor:** regroup weapons into Target-Indicated Clusters and the card's
  damage / range brackets recompute live.
- **Quirks, BV, and role** are looked up from prebuilt indexes and shown on the
  card (BV is skill-adjusted). Quirk effects (e.g. cooling jackets, stabilized
  weapons) bake into the card values when enabled.
- **Equipment-aware modifiers:** Targeting Computer (−1 to-hit on direct-fire
  weapons, folded into the printed ranges), MASC / Supercharger movement boosts,
  and melee weapons surfaced from crit slots (hatchet, sword, mace, …) with
  their to-hit modifiers.
- **Armor-type pip shapes** so Ferro / Stealth / Hardened / Reflective-Reactive
  read apart at a glance on the paper dolls.
- **Random Assignment Tables (RAT):** roll a force from era/faction tables.
- **Print sheet:** lay the whole force out on a print-optimized page.

### Play (Battle mode)
- **Force builder** with persistent, switchable rosters; organize units into
  **lances / stars** (free-form formations) that carry into battle.
- **Damage tracking** on interactive paper dolls: per-location armor + structure
  pips, engine / gyro / leg-actuator crits, the pilot consciousness track,
  heat, and per-bin ammo.
- **Cinematic Initiative:** 2d6 + bonus, high wins; units activate by TMM
  bracket (lowest first, loser-of-initiative first within a bracket), with an
  optional **Modified Reactions** rule that lowers a unit's bracket by its
  damage and heat.
- **Per-unit movement choice** (Still / Walk / Sprint / Jump) that sets the
  shown TMM for that activation.
- **Three sub-phases per round — Movement → Combat → End** — sharing one
  initiative roll.
- **End phase prompts:** a 'Mech that took **10+ damage**, a **gyro hit**, or a
  **leg-actuator hit** this round is flagged for a **falling (Piloting) check**;
  a pilot that took a hit is flagged for a **consciousness check** at the right
  target number.
- **Heat affects the card itself:** heat 1+ cuts Move / TMM (and the initiative
  bracket under Modified Reactions); heat 2+ adds +1 to every printed ranged
  to-hit modifier.
- **Pilot hits** add +1 to Gunnery and Piloting (shown on the card and folded
  into the to-hit helper).

### Multiplayer (zero-setup)
Online battles run over **Supabase Realtime**, baked into the build
(`src/web/mp-config.ts`). The Supabase **anon** key is a public client
credential by design, so it ships in the page and works for everyone who opens
the site — no accounts, no setup for players. One side hosts and shares a room
link; forces, damage, heat, and initiative sync in real time. (See "Multiplayer
backend" below to point it at your own Supabase project.)

## Architecture

Cleanly separated layers — the separation is the point:

```
src/core/      Pure functions. ZERO Node/browser/filesystem dependencies.
  types.ts        Domain types: Unit + OverrideCard, and the per-kind cards.
  parser.ts       .mtf text -> typed BattleMech Unit.
  blk.ts          .blk text -> typed unit (BA / vehicle / fighter / proto / …).
  convert.ts      Unit -> OverrideCard (the 'Mech conversion math).
  battlearmor.ts / vehicle.ts / fighter.ts / proto.ts / infantry.ts / dropship.ts
                  Per-kind conversions, all reusing the shared weapon engine.
  dispatch.ts     detectFormat() + convertAny(): route each file to its path.
  constants.ts    Every magic number, each citing the rule it implements.
  index.ts        Barrel export (safe in Node OR a browser bundle).

src/web/       Browser UI. Card renderers (one per kind), the SVG paper dolls,
               the TIC editor, quirk effects, the battle tracker + initiative,
               and the multiplayer client. Imports the same pure core.
src/cli/       Node CLI wrapper. The ONLY core-adjacent layer that touches disk.
scripts/       Build helpers: extract-units, data-index builders, inline, icons.
tests/         Vitest unit tests + .mtf/.blk fixtures + oracle snapshots.
```

`core` runs unchanged in both Node and the browser. The **parser is fully
decoupled from the conversion math**: the parser knows nothing about Override
scoring, and the converter knows nothing about MTF/BLK text. Either can be
swapped or extended independently. The web layer never duplicates core math; it
injects display-only extras (BV / quirks / role / TC badges, play-mode
penalties) by wrapping the rendered card HTML.

## Install & build

```bash
npm install
npm run build        # tsc -> dist/ (core + cli)
npm test             # vitest (currently 271 tests)
npm run typecheck    # tsc --noEmit (core/cli)
npm run typecheck:web# tsc --noEmit (web layer)
```

## Web UI

```bash
npm run dev:web      # Vite dev server with live reload
npm run build:web    # extract units -> vite build -> inline into ONE dist-web/index.html
npm run preview:web  # serve the production build locally
```

`build:web` runs three steps: `scripts/extract-units.mjs` stages the bundled
unit library and indexes, `vite build` compiles the app, and
`scripts/inline.mjs` folds the JS/CSS into a single self-contained
`dist-web/index.html`. The data indexes (BV, availability, RAT, quirks, weapon
quirks, roles) are prebuilt by the `build-*-index` scripts and committed under
`public/`.

### Deploying to GitHub Pages

`.github/workflows/deploy-pages.yml` builds `dist-web/` and pushes it to a
`gh-pages` branch on every push to `main` (and `claude/**` branches, for
previews). **One-time repo setup:** Settings → Pages → *Build and deployment* →
**Source: Deploy from a branch**, then **Branch: `gh-pages` / `(root)`**. After
that the site publishes automatically (typically
`https://<user>.github.io/<repo>/`). The Vite `base` is `"./"`, so the build
works under the Pages project subpath without hard-coding the repo name.

### Multiplayer backend (optional, to use your own project)

Online play already works out of the box. To point it at your own (free)
Supabase project: create one, then in **Project Settings → API** copy the
**Project URL** and **anon public** key into `src/web/mp-config.ts`
(`SUPABASE_URL` / `SUPABASE_ANON_KEY`) and redeploy. Only the **anon** key
belongs here — never commit the `service_role` key.

## CLI usage

```bash
# Dev (no build step):
npx tsx src/cli/index.ts <file-or-dir> [more ...] [options]

# After build:
node dist/cli/index.js <file-or-dir> [more ...] [options]
```

Accepts one or more `.mtf`/`.blk` files **or** directories (scanned for them);
the format is auto-detected per file via `convertAny()`.

| Option | Effect |
|---|---|
| `--out <dir>` | Output directory for per-unit JSON (default: current dir) |
| `--csv` | Also write a flat CSV of all units (`override-cards.csv`) |
| `--no-json` | Skip per-unit JSON output (summary/CSV only) |
| `-h`, `--help` | Show help |

For each unit the CLI writes one `<Chassis>_<Model>.override.json` and prints a
readable summary to stdout.

## Conversion rules (in `convert.ts` / `constants.ts`)

| Field | Formula | Rounding |
|---|---|---|
| Weapon damage | sum of TW damage in a TIC ÷ 3 | **up** |
| 'Mech torso armor | (CT + LT + RT) ÷ 6 | nearest |
| 'Mech rear armor | (CTr + LTr + RTr) ÷ 6 | nearest |
| Head armor | bracket on head TW: 0–2→1, 3–5→2, 6–7→3, 8–9→4, cap 5 | lookup |
| Arms/legs armor | TW ÷ 3, min 1 | nearest |
| Structure / section | IS ÷ 3, min 1 — per section (torso from CT, head, arms, legs) | nearest |
| Heat dissipation | total dissipated/round ÷ 5 (doubles dissipate 2 each) | nearest |

Rounding is **per field** — `roundUp()` for damage, `roundNearest()` for
armor/structure/heat. Do not assume a single rounding mode.

### Movement & TMM

Override uses Classic movement directly at 1:1 board scale (1 hex = 1 inch), so a
5/8 'Mech has walk move 5, run move 8 — carried straight over. **Jump is its own
mode** (TMM = the movement bracket + 2). **TMM is a bracket lookup keyed on RUN
MP**; sprint adds +1 to base TMM. The card prints base / sprint TMM and the jump
TMM. MASC / Supercharger multiply movement (×1.25 one, ×1.5 both).

### Internal structure note

MTF files do **not** contain internal-structure values; the parser derives them
from the TechManual internal-structure-by-tonnage table
(`INTERNAL_STRUCTURE_BY_TONNAGE`), keyed on mass — a non-standard tonnage fails
loudly. `TORSO_STRUCTURE_BY_TONNAGE` holds per-tonnage torso corrections that
take precedence over the formula; add a row whenever a verified builder value
differs.

## Validation — the DFA oracle

**The DFA Override Card Generator is the ground-truth oracle.** To validate a
unit, convert it there and **diff the card against this tool's output**.
Mismatches almost always point to one of two things:

1. a **weapon-table** gap or wrong TW value (`WEAPON_DAMAGE` in `constants.ts`,
   with `WEAPON_DAMAGE_CLAN` for tech-base overrides), or
2. a **rounding** error (wrong `roundUp` vs `roundNearest` for that field).

`WEAPON_DAMAGE` is a separate, easily-extended export — add a row (with a rule
citation) when you hit an unknown weapon. Unknown weapons don't crash; they
convert to damage 0 and warn on the card. Range brackets (PB/S/M/L/X) and TIC
grouping are implemented; the oracle-snapshot tests in `tests/` pin known cards
against captured output so regressions surface immediately.

> ⚠️ **TMM bands for run ≥ 13 are INFERRED** (from Alpha Strike CE) and
> UNVERIFIED. Verified bands: run 3→0, 6→1, 8→2, 9→2, 11→3.

## Tests

`npm test` runs the Vitest suite (parser, every per-kind conversion, the TIC
editor, quirk effects, the biped/quad doll, and oracle snapshots). Fixtures live
in `tests/fixtures/`; expected values are cross-checked against DFA cards where
possible.
