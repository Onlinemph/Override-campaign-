# OVERRIDE GM Tool

A double-blind campaign manager for tabletop BattleTech, run by a human GameMaster.
Implements the **OVERRIDE** campaign rules (Module 0), with **SKYWATCH** (Module 1) and
**DEEP SKY** (Module 2) to follow. The four documents in `docs/` are the complete
requirements; `DECISIONS.md` logs every judgment call.

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

```sh
npm install
npm run dev                          # in-memory demo campaign
npm run dev -- demo/campaign.json --log war.jsonl   # persist + resume from war.jsonl
```

Then open `http://localhost:8420/gm` — the GM screen (truth map with belief overlays,
event log, step / run-until-event, noise injection, VP & endings). The GM screen lists
the **tokenized player links** to hand out; they also print to the console at boot
(e.g. `/player/blue/<token>`). Player screens show own forces, contacts with staleness,
the report inbox, and click-to-plot order entry. All maps scroll-to-zoom and drag-to-pan.

The demo is a 25-VP campaign: a satellite (watch its passes catch GHOST returns), an
airbase, a supply convoy, hidden and contested objectives, a system layer with a gas-giant
picket, and a red probe force already moving. Click **Run until event** a few times.
Pass `--log <file>` to make it survive a restart.

## Build your own campaign

Campaigns are plain JSON — copy `demo/campaign.json` and edit it, or write one from
scratch. Every field (terrain, forces, facilities, the system graph, objectives, victory
conditions, opening orders) is documented in **[docs/CAMPAIGN_FORMAT.md](docs/CAMPAIGN_FORMAT.md)**.
The loader validates on start and reports any mistakes in plain language
(`formation "f1": hex 99,1 is outside theater "t1" (8×8)`), so authoring is self-serve.
Run yours with `npm run dev -- mycampaign.json --log mywar.jsonl`.
Or use the **visual editor at `/editor`**: paint terrain/infra/objectives on the map,
drop units and facilities, set sides and victory conditions, and download a validated
`campaign.json` (live error-checking as you build). DEEP SKY system graphs, satellites,
orders and markers round-trip through the editor and can be hand-tuned in the file.

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
- [ ] **M8 — Full combined-arms kit**: combat drops, orbital standby, escort/SAR/tanker
      missions, transponders & false flags, blockades — toward the §12.3 Cavanaugh frame.

*Fan project; BattleTech © The Topps Company, Inc., published by Catalyst Game Labs.*
