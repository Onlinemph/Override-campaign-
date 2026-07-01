# OVERRIDE GM Tool

A double-blind campaign manager for tabletop BattleTech, run by a human GameMaster.
Implements the **OVERRIDE** campaign rules (Module 0), with **SKYWATCH** (Module 1) and
**DEEP SKY** (Module 2) to follow. The four documents in `docs/` are the complete
requirements; `DECISIONS.md` logs every judgment call.

**New here?** Start with the **[beginner tutorial](docs/TUTORIAL.md)** — it assumes no
knowledge of BattleTech, double-blind play, or this tool, and walks from "what is this"
through running your first session.

## Architecture (spec §0)

Event-sourced fog-of-war engine:

- **One Truth State**, mutated only by an append-only **event log**
  (`src/core/events.ts`, JSONL store in `src/core/log.ts`).
- **Seeded, logged RNG**: every die is a pure function of `(campaignSeed, seedCursor)`;
  every roll is logged with its cursor and is independently re-derivable (`src/core/rng.ts`).
- **Player views are pure projections** — `project(truth, sideId, now)` in
  `src/projection/project.ts`; never persisted, structurally unable to leak unearned info.
- **Every game constant** lives in `src/rules.ts`, organized to mirror the rulebooks'
  quick-reference appendices. House-rule numbers there; the engine has no magic numbers.
- **Battles are never simulated**: the engine exports a HandoffPackage and ingests a
  BattleResult (forms land in Milestone 2).

## Run it

First time, one command sets up everything (campaign + the embedded battle tracker):

```sh
npm run setup    # installs deps and builds the battle tracker
npm run update   # later: git pull + reinstall + rebuild, in one step
```

Then:

```sh
npm install                          # (npm run setup already did this)
npm run dev                          # in-memory demo campaign
npm run dev -- demo/starter.json --log war.jsonl    # a small, original starter scenario
npm run dev -- demo/campaign.json --log war.jsonl   # persist + resume from war.jsonl
npm run dev -- demo/campaign.json --gm-key sekret    # require a passphrase for the GM screen
```

`--gm-key <phrase>` (or `OVERRIDE_GM_KEY`) gates `/gm`, `/audit`, `/editor`, and the
`/api/gm/*` endpoints behind a passphrase while player links stay token-only — set it
before exposing the server to the internet (e.g. through a tunnel), or any player who has
their own link can open `/gm` and see the whole truth.

Then open `http://localhost:8420/gm` — the GM screen (truth map with belief overlays,
event log, step / run-until-event, noise injection, VP & endings). The GM screen lists
the **tokenized player links** to hand out; they also print to the console at boot
(e.g. `/player/blue/<token>`). Player screens show own forces, contacts with staleness,
the report inbox, and click-to-plot order entry. All maps scroll-to-zoom and drag-to-pan.

The demo is a 25-VP campaign: a satellite (watch its passes catch GHOST returns), an
airbase, a supply convoy, hidden and contested objectives, a system layer with a gas-giant
picket, and a red probe force already moving. Click **Run until event** a few times.
Pass `--log <file>` to make it survive a restart.

## Battle tracker & record sheets (embedded card builder)

The [OVERRIDE Card Builder](https://github.com/Onlinemph/Override-card-builder) is vendored
under `cards/` and serves two roles.

**Unit stats come from the real record sheets.** On load, each unit's model is resolved
against the bundled MegaMek library and its `.mtf`/`.blk` is parsed to fill in movement,
class, BV, and electronic-warfare gear — Guardian→`ECM`, Angel→`ANGEL_ECM`,
Beagle/Bloodhound/Watchdog→`BEAGLE`, stealth→`STEALTH`, C3 Master→`C3M`, Mobile HQ→`HQ`,
wheeled→`WHEELED`. Only *unset* fields are filled (explicit campaign values always win;
tags merge), so ECM raises the enemy's detection TN, a probe or HQ extends sensor range,
and speed sets the map pace — automatically, with no engine changes. (Opt out with
`CAMPAIGN_NO_ENRICH=1`.)

**An interactive battle tracker at `/battle`.** When the campaign freezes on a pending
engagement, click **Export handoff** → **⚔ Open battle tracker** on the GM screen. The
campaign builds a per-side roster (models, pilot skills, and the fog-of-war setup) and
opens `/battle` pre-loaded with both forces as real Override record cards, plus a campaign
briefing (entry edges, initiative, posture, off-board support). Play it out, then **⇧ Send
result to campaign** folds the marked-up cards into a `BattleResult` — damage state
(DESTROYED vs recoverable SALVAGE), ejected crews, victor — and posts it back, where it
ingests and unfreezes the campaign (double-ingest is refused).

**Aerospace merges** are first-class: a fighter / aerospace / DropShip gets a **✈ Flight
panel** in play mode — fuel points with live **joker/bingo** thresholds (a `BINGO —
disengage` warning when it runs low), velocity vs safe/max thrust, altitude, and thrust
used — seeded from the air/space handoff's entry state. Fuel that survives the merge comes
home as `fpRemaining`, updating the unit's campaign fuel ledger. Flights can be **carrier-
based**: point a flight's home at a DropShip (`homeCarrierId`) and its RTB distance and
joker/bingo track the carrier's position as it moves.

`npm run setup` builds the tracker; `npm run dev` (and `start.cmd`) build it on first launch
if it's missing. Needs only Node — the build unpacks the library with a pure-Node fallback,
so no `unzip`/WSL on Windows.

Derivation runs everywhere units enter play (initial force, `/api/gm/load`, and GM
reinforcement spawns), a unit's MUL role maps `Scout`→`RECON`, and the derived gear +
sensor reach show in the own-forces panels and map tooltips. The **`/editor`** unit rows
have a **library search** — type a chassis, pick a real unit, and its model/class are set
(the rest derives on load).

## Build your own campaign

Campaigns are plain JSON — copy `demo/campaign.json` and edit it, or write one from
scratch. Every field (terrain, forces, facilities, the system graph, objectives, victory
conditions, opening orders) is documented in **[docs/CAMPAIGN_FORMAT.md](docs/CAMPAIGN_FORMAT.md)**.
The loader validates on start and reports any mistakes in plain language
(`formation "f1": hex 99,1 is outside theater "t1" (8×8)`), so authoring is self-serve.
Run yours with `npm run dev -- mycampaign.json --log mywar.jsonl`.
Or use the **visual editor at `/editor`**: paint terrain/infra/objectives on the map,
drop units and facilities, set sides and victory conditions, and download a validated
`campaign.json` (live error-checking as you build).

**Campaign generator (in the editor).** Don't start from a blank map — hit **🎲 Generate**
(name / size / seed) for a **coherent random map**: clustered woods, hills, water, rough,
swamp and mountains plus a town or two joined by a road, seeded so it's reproducible. Then
paint over it and add objectives/bases with the normal tools. Under **Armies**, **🎲 Roll
force** pulls a real force from the bundled card library for the active side (filter by
class / weight class / era / BV) — or **Import card force** drops in a force you built in the
`/battle` app. Stats derive from the record sheets on load. **▶ Start campaign** builds and
launches the generated campaign live on the GM screen (no file round-trip needed).

A **System (DEEP SKY) view** in the same editor builds the node-and-lane graph visually
— drop nodes by type, draw lanes (with AU distances), place vessels, set secret pirate
points and node objectives. Satellites, orders and markers round-trip and can be
hand-tuned in the file.

## Test

```sh
npm test         # 115 tests incl. the Milestone 1 acceptance scenario
npm run typecheck
```

The Milestone 1 acceptance test (`test/acceptance/m1-hidden-battalion.test.ts`) plays
the spec's scripted scenario: a battalion (EMCON DARK, woods, night, cautious movement)
crosses a sensor line at TN 12 — effectively invisible, every silent roll logged — and
the defender's off-net scout's contact report delivers only when the scout physically
returns to the command net, original timestamp preserved.

## Milestones

- [x] **M1 — Kernel**: entities, event log, seeded RNG, tick loop with clock compression,
      Module-0 ground movement + detection + contact ladder + per-side views.
- [x] **M2 — Orders & engagement**: conditional triggers, STRIKE/SCREEN, evasion,
      engagement freeze, HandoffPackage export / BattleResult import round-trip, salvage,
      rout, RDY/Dig-In/supply upkeep. GM resolves battles from the GM screen; the demo
      drives itself to an engagement on *Run until event*.
- [x] **M3 — SKYWATCH**: flight ledger engine, alert board (launch delays, idle burn,
      crew fatigue), plotted air missions with conditional scrambles, predictive chase
      mode in contact turns, live joker/bingo with auto-RTB at bingo, the merge export
      (map by band, entry velocity, Energy State, surprise, per-fighter FP/joker/bingo),
      turnaround & fuel farms. *Acceptance passed: the §12 Shilone day tick-for-tick —
      400→240→179→159 FP, the 0901 scramble, the farm down to 11 tons, Fatigue 3.*
- [x] **M4 — DEEP SKY**: node-and-lane system graph, brachistochrone integrator with
      burn-day ledgers & gas-giant skimming, the light-lag intelligence layer
      (jump flashes & drive plumes as delayed automatic contacts; cold coast / station-
      keeping rolled per watch), the encounter classifier (MATCHED/SLASH/STERN_CHASE/
      BLOCKADE) feeding the capital handoff, and the jump board (sail recharge,
      emergency furl, quick-charge, pirate points, the JumpShip taboo).
      *Acceptance passed: Operation SKEAN — the flash lands planetside 83 minutes after
      a 10 AU jump, the cold detachment stays SIG 11 until the gas-giant picket's active
      sweep, and the classifier returns MATCHED with ~2.1 burn-days of margin.*
- [x] **M5 — Polish**: SVG hex map (terrain, fog of war, units, contacts with staleness,
      satellite tracks, click-to-plot order paths) and the system graph on every screen;
      GM belief overlays (truth beside what each side has been *told*); the
      noise-injection editor (edit reports in transit, conjure phantom contacts);
      best-effort MegaMek `.mul` export per side from any handoff; and the audit viewer
      at `/audit` — scrub the entire campaign with the fog lifted.

The five spec milestones are complete. Beyond the spec, toward real game nights:

- [x] **M6 — Campaign-ready**: JSONL persistence with resume-on-restart (`--log`);
      VP scoring (objective control + daily accrual) and endings (VP threshold /
      wall-clock); per-side access tokens on player links; scroll/drag map zoom & pan.
- [x] **M7 — Fires & logistics**: artillery FIRE missions (Quick-Resolved out of battle)
      with the spotter loop and counter-battery auto-reveal (the §6.5 chaff trick falls
      out); the engineer toolkit (lay/breach mines, demolish/build bridges) and minefields
      that bite movers; path-based supply lines with road/off-road cost, SP draw from
      depots & convoys, the RESUPPLY pipeline, and interdiction that starves a cut-off
      spearhead. *Acceptance: the chaff trick + a starved offensive, both byte-exact on replay.*
- [x] **M8 — Combined-arms kit**: combat drops (scatter + LOCK reveal), SAR pickups &
      tanker offloads, transponders & false-flag inspection (a hard-burning warship can't
      hold a merchant squawk), and blockades that cut off-world SP imports when the enemy
      holds your jump points. *Acceptance: a Cavanaugh-style assault — false flag →
      blockade → combat drop → spaceport taken → SAR — byte-exact on replay.*

All eight milestones complete. Remaining deferrals (table/GM concerns or a future pass)
are logged in DECISIONS.md D-014.

*Fan project; BattleTech © The Topps Company, Inc., published by Catalyst Game Labs.*
