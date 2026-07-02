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

**Playing online?** See **[docs/HOSTING.md](docs/HOSTING.md)** — a free 2-minute tunnel
for game night, an always-on Railway deploy (~$5/mo), or the bundled `Dockerfile` for
Fly.io / any VPS. `PORT`, `OVERRIDE_GM_KEY`, `OVERRIDE_LOG`, and `OVERRIDE_CAMPAIGN` env
vars configure everything; the JSONL log is the whole campaign — copy it and you have a
byte-exact backup.

**Play it as a slow war.** Hosted campaigns run **asynchronously**: set
`OVERRIDE_AUTOPACE=60` (or the GM screen's ⏱ control) and the clock steps itself,
pausing automatically when a battle freezes the campaign — that ⚔ ping is what gathers
the group for battle night. Wire `OVERRIDE_WEBHOOK_<SIDE>` / `_GM` to Discord webhooks
and each side gets pinged with **only what its own screens would show** — delivered
contact reports, repairs finishing, BINGO fuel calls. Fog of war holds in Discord; players
drop in whenever, plot orders, and the war moves on.

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

**CAS reaches the table.** A flight holding a CAS or STRIKE_AIR mission near the battle
shows up in the handoff as **off-board air support** — the briefing lists each side's
flights with arrival timing ("overhead now" vs "first ~turn 2") and fuel state, so the
tabletop knows exactly what's circling above the fight.

**The record sheet persists.** The marked-up card comes home with the result — armor by
location, crits, heat, ammo bins, pilot hits — and the *same boxes reappear* in the next
battle unless dealt with: the repair shop returns a clean sheet, a rearm clears just the
ammo boxes, and a recovered pilot takes their hits off the card. Pilot recovery scales
with the beating taken: **3 days per hit, 1 per hit with a MASH** on your side.

**Aerospace merges** are first-class: a fighter / aerospace / DropShip gets a **✈ Flight
panel** in play mode — fuel points with live **joker/bingo** thresholds (a `BINGO —
disengage` warning when it runs low), velocity vs safe/max thrust, altitude, and thrust
used — seeded from the air/space handoff's entry state. Fuel that survives the merge comes
home as `fpRemaining`, updating the unit's campaign fuel ledger. Flights can be **carrier-
based**: point a flight's home at a DropShip (`homeCarrierId`) and its RTB distance and
joker/bingo track the carrier's position as it moves.

**Carriers are physical.** Give a formation a `carrier: { bays, crews, avFuelTons }` and it
becomes a DropShip that actually hauls units. A formation with `mountedOn` (or embarked in
play) rides in a bay — it moves exactly where the carrier moves and can't march, fly, or
burn on its own until it steps off. The GM screen's **Carrier ops** panel drives the whole
cycle: **load/unload** ground units in the carrier's hex, **launch** an embarked flight
into the air (climbing from a landed DropShip or launching mid-air from one already aloft,
homed on the carrier), **recover** a co-located flight back into a bay, and **rearm** it
from the ship itself — a turnaround that ties up a carrier crew and draws aviation fuel from
`avFuelTons`, no ground fuel farm required. A carrier board shows each DropShip's bays,
free crews, fuel, and who's aboard; lose the carrier and its embarked units are stranded at
its last position rather than vanishing with it. Carriers are authorable in the **`/editor`**
too — tick **carrier** on a formation (bays / crews / av fuel) and pick **embarked in** on
another to start it stowed in a bay (it snaps to the ship's hex); live validation catches
overloaded bays, cross-side loading, and nested carriers as you build.

**Hull shape matters.** The record sheet's motion type derives onto every DropShip:
**spheroids move 1 air hex per contact turn** in atmosphere — cruise or dash, thrust be
damned — while aerodynes fly a full 12-hex cruise. A spheroid that wants to reposition
fast goes *up*: ASCEND to orbit, cross the system map, DESCEND over the target theater,
and LAND. Chase prediction and CAS arrival timing all respect the crawl, so a spheroid
gunship two hexes from the battle is honestly two turns away in the briefing.

**The sky is one continuous system.** Two orders bridge DEEP SKY and SKYWATCH: **DESCEND**
re-enters from a planet/moon node into its theater's air layer (~18 min, a modest braking
burn — the atmosphere does the work), and **ASCEND** climbs the well from the air (or
straight off the ground: lift, then burn) to the orbit node — the expensive direction.
Cargo rides through both. And carrier-based fighters now **recover themselves**: a flight
that goes RTB flies home to its DropShip and lands straight into a free bay — a full bay
group means a wave-off, holding over the ship until one opens. A player can plot a DropShip
from a pirate point to a dirt landing with its fighters cycling overhead, no GM fiat at any
step: `DESCEND → LAND → DISEMBARK`, fight the campaign, `EMBARK → ASCEND` back out.

**And the ground shoots back.** A formation with an `AA`-tagged unit throws a **flak
umbrella** over its hex and two around it. Tactical AA can't reach HIGH-band transit — it
bites at the *interface points*, where aircraft come low over a specific hex: climb-out on
launch, final approach on any landing (open-field, airbase, or carrier recovery), and the
drop pass of a combat drop (which also scatters +2 through flak). Each battery in range
gets one logged 2d6; a hit degrades the aircraft one damage step — flak batters, it never
one-shots. The bargain cuts both ways, same as counter-battery: **firing reveals the
battery at CONTACT** to the aircraft's side, so an AA umbrella is a trap you spring, not a
passive wall. Route your landings around what you've scouted — or eat the gauntlet.

**Players fly their own DropShips.** Carrier ops are plotted orders through the double-blind
command net, not GM table-talk: **EMBARK** marches a formation to its ship and loads it
(waiting at the ramp if the bays are full or the ship is aloft), **DISEMBARK** steps off a
landed carrier into a chosen adjacent hex, **LIFT_OFF** launches and *holds at altitude*
(a standing order — the ship loiters on the fuel ledger until the next order supersedes it),
and **LAND** puts down on any passable hex, no facility needed — water and mountains wave it
off. LAND outranks a fuel-forced RTB, so putting a bingo ship down *now* always works. A
**stowed fighter flight given any air mission scrambles straight off the deck**, homed on its
carrier. The player screen shows your bays and rides on every formation card, and the order
panel picks the carrier / target hex from the map. All of it obeys the net: an off-net
DropShip runs on standing orders like everything else.

`npm run setup` builds the tracker; `npm run dev` (and `start.cmd`) build it on first launch
if it's missing. Needs only Node — the build unpacks the library with a pure-Node fallback,
so no `unzip`/WSL on Windows.

Derivation runs everywhere units enter play (initial force, `/api/gm/load`, and GM
reinforcement spawns), a unit's MUL role maps `Scout`→`RECON`, and the derived gear +
sensor reach show in the own-forces panels and map tooltips. The **`/editor`** unit rows
have a **library search** — type a chassis, pick a real unit, and its model/class are set
(the rest derives on load).

## The career loop — pilots that live, wrecks that come home

Between battles the campaign now runs a light MekHQ-style persistence layer:

**Pilots have careers.** Every named crew that survives a battle earns XP (+1 surviving,
+1 more when their side wins, +2 per kill credited in the result); every 8 XP the weaker
of gunnery/piloting improves (floors G1/P2), and the fifth kill turns on the **★ ace**
flag. Wounds heal on the clock — a `WOUNDED` pilot is fit for duty 3 days later. The GM
screen's **Company roster** lists everyone: skills, XP, kills, status, and who's riding
what.

**Damage heals in the shop.** A `DAMAGED` or `CRIPPLED` unit whose formation sits on a
friendly **depot / factory / spaceport** hex (or rides embarked in a carrier with a free
turnaround crew) can be repaired — SP and days scale with how bad it is (1 SP / 1 day
damaged, 2 SP / 3 days crippled). Players queue it themselves with the **REPAIR** order
(a quick-button on the player screen): every damaged unit in the formation goes onto a
bench as SP and crews allow, the queue waits out shortages and resumes when a convoy
restocks the depot, and the order completes when the whole formation stands at OK. The
GM's per-unit 🔧 button remains for cherry-picking.

**The recon tricks work.** **SHADOW** trails a contact at a two-hex standoff — closing when
the trail stretches, holding when near, never blundering into a battle — a standing order
your scout keeps until told otherwise. A **C3 master** on the table is worth +1 initiative
in the handoff. A **DECOY** unit makes its formation read one size class bigger to enemy
sensors (close recon at LOCK still sees the truth). And air kills **rain down**: wrecks
from a won merge land as salvage tokens on the map below, feeding the refit yard.

**Ammo is a resource.** Units come home from battle PARTIAL or DRY, and staying dry is now
a choice: the **REARM** order draws 1 SP per unit from a depot, factory, or spaceport in
the hex — or from a convoy that drove the shells forward — and waits at the dump if the
stock isn't there yet. Factories mint SP daily while you hold them, hiding (**Hold**) and
digging in actually work as plotted orders, moving breaks both postures, and a **MASH**
unit on your side cuts wound recovery from three days to one.

**Salvage joins your roster.** Resolving a salvage token (2d6 ≥ 8, as before) now queues a
**refit project** on a UNIT result — spend 3 SP at a repair-capable facility and 4 days
later the rebuilt mech is delivered to a formation you pick, crewed by the first pilot
waiting in your **POOL** (SAR pickups feed the pool). A PARTS result credits 2 SP to the
depot in the wreck's hex. Your company's story — the mechs you took, the pilots who
earned their skills — persists across the whole campaign, byte-exact on replay.

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
