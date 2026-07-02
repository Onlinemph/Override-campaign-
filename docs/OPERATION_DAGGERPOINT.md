# OPERATION DAGGERPOINT — Menghao, 3067

The showcase campaign: a full planetary assault that touches **every mechanic in the
engine**. The 1st Kittery Borderers (AFFS) jump into a Capellan border system to take
Menghao's spaceport, factory district, and airfield from the Prefectorate Guard before
the month is out.

```sh
npm run dev -- demo/assault.json --log daggerpoint.jsonl --gm-key YOUR-SECRET
```

Two players (or one per lance if your table is big), one GM. Battles on the physical
table as always — the campaign feeds them and eats their results.

## The situation

**Davion (attacker)** — a task force at the zenith point, just jumped in: the JumpShip
*Excalibur's Word* (sail deployed, charging), the Overlord *Fortune's Hammer* (command
lance, cavalry lance, artillery, AA — 4 bays), the Union *Halberd* (armor, recon, the
trains, engineers), the Leopard CV *Swift Wing* (two fighter flights in the bays), and —
running dark from the **nadir** under a merchant squawk — the *Kestrel*, with a battle
armor squad aboard. **No resupply is coming: the trains carry 20 SP and after that it's
the spaceport or starvation.**

**Liao (defender)** — the Menghao Prefectorate Guard: a mech company (including a Raven
3L and two stealth Sha Yus lying HIDE in the eastern woods), Po armor, dug-in flak
batteries at the spaceport and airfield, a Long Tom battery, minefields on the eastern
road, infantry in the factory district, a fighter flight on ALERT-15, a grounded Union
with two more fighters stowed, a recon satellite overhead, a picket skimming fuel at the
gas giant — and 3 SP/day of off-world imports through the jump points, **which stop the
moment Davion holds both**.

**Victory**: 100 VP (objectives accrue daily — spaceport 3, factory 2, airfield 1, the
gas giant refinery 1) or best position at day 30. Left alone, the Guard banks ~7/day and
wins in a fortnight: **the attacker is on a clock**, and every objective flipped swings
the race by double.

## The first session, beat by beat

1. **The burn (Days 0–3).** The fleet's TRANSIT orders are pre-plotted: 8 AU at 1G.
   Liao's screens light up ~66 minutes after the burn starts — light lag — and the
   drive plumes tell them tonnage and vector. They know you're coming; they don't know
   where you'll land. *(DEEP SKY: lanes, brachistochrone, light-lag intel. The Kestrel:
   COLD_COAST + false flag — inspect it with the picket and see if the lie holds.)*
2. **Make orbit, go down the well.** DESCEND over Menghao (~18 min), then LAND on the
   eastern plain at (21,9) — outside the flak umbrellas, which the walkthrough GM knows
   and the players must scout. The Overlord is a **spheroid**: 1 air hex per turn in
   atmosphere, so there's no joyriding — land where you descend, or hop back through
   orbit. The Leopard CV is **aerodyne**: it can actually fly CAP station over the LZ.
   *(ASCEND/DESCEND, LAND anywhere, spheroid rule, flak umbrellas, RAIN's detection
   penalty covering the approach.)*
3. **Boots down.** DISEMBARK the lances; scramble a fighter flight straight off the
   Swift Wing's deck for a RECON pass. The Raven's ECM and the satellite's passes make
   the recon game two-way. Watch for the **fake radar site** at (18,4) — it reads like a
   battalion because the "garrison" is inflatable decoys. *(Carrier ops, deck scrambles,
   EMCON, DECOY, satellite passes, HIDE — the Sha Yus are somewhere in those woods.)*
4. **The approach.** The eastern road is mined (the Pioneers can BREACH), the Long Tom
   answers anything the Guard's spotters see (counter-battery reveals it — then it
   shoots and scoots), and the Guard's Raven SHADOWs your column at standoff. First
   contact between line formations freezes the campaign: **battle night**. The handoff
   carries entry edges, initiative (Kerr's C3M buys +1), CAS on station with arrival
   turns, artillery in range, dug-in defenders, RDY penalties — print it, play it on
   the table, feed the marked cards back. *(Engagement freeze, handoff, CAS-to-table,
   C3M, fires, engineering, SHADOW.)*
5. **The long war.** Damage persists on the sheets — the same left-torso boxes come
   back next battle unless repaired. REPAIR at a captured facility (or in the
   DropShips' bays), REARM from the trains, salvage the field — recovered wrecks refit
   into your roster with POOL pilots, air kills rain down as salvage, the wounded heal
   (3 days per hit — 1 with the MASH trucks both sides brought). Take both jump points
   and the Guard's imports stop; take the spaceport and yours start. *(Careers, sheet
   persistence, repair/rearm/refit economy, salvage, blockade, factory output.)*

## GM crib sheet

- **Autopace + Discord** (see HOSTING.md) make this a slow war between battle nights.
- The pirate point (2 AU out!) is secret and Liao holds the survey — espionage or a
  captured nav core (`surveyNode`) hands Davion the fast back door.
- The hidden supply cache at (20,12) is a scoutable prize on the Davion approach.
- Undo (`↶`), noise injection, and the audit viewer all work here as everywhere.

## Mechanics checklist (what this campaign exercises)

Event-sourced clock & compression · double-blind detection ladder & reports · command
nets & off-net couriers · ground movement/terrain/roads · HIDE/DIG_IN/patrols ·
minefields & engineers · artillery + counter-battery · satellites · ECM/BEAGLE/STEALTH/
C3M/DECOY/HQ/AA/MASH derivation from real record sheets · engagement freeze → printable
handoff → tracker cards → BattleResult ingest · salvage → refit → careers (XP, aces,
wounds, MASH) · sheet damage persistence · repair/rearm economy, factory output, convoy
resupply, supply lines & starvation · carriers (bays/crews/av fuel), embark/disembark,
deck scrambles, auto-recovery, carrier rearm · LIFT_OFF/LAND/ASCEND/DESCEND, spheroid vs
aerodyne · flak umbrellas · CAS on call · jump board & sail recharge · lanes,
brachistochrone burns, light lag, cold coast · false flags & inspection · gas-giant
skimming · pirate points · blockades & imports · VP objectives (real, hidden, and fake)
· endings · autopace + fog-scoped Discord pings · byte-exact replay of the whole war.
