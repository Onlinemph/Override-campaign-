# Operation RIVERWARD — Cascara, 3068

*The showcase for generated geography: a river-line defense where the bridges are the
stars. Nothing on this map was placed by hand — the scenario script generated a
continent, then read it, and stationed both armies at what it found.*

```
npx tsx scripts/make-riverward.mjs        # regenerate demo/riverward.json (optional)
npm run dev demo/riverward.json           # play it
```

## The situation

The 10th Skye Rangers have landed on Cascara. Their DropShips sit at a cold LZ in the
radar gap on the far bank of the **Verdigris** — the great river that crosses the whole
continent from the interior to the sea. Between the Rangers and the capital lie three
bridges. The Cascara Home Guard knows exactly what it has to hold.

The map is a 120×80 generated continent (seed `RIVERWARD-9`): mountain ranges with
carved passes, the great river and its tributaries, biome forests, a capital in the
northwest with a rail trunk to its northern town, and a road network that crosses the
water at three spans — **Argent Span** (west, on the capital road), **Kingsbridge**
(center-north), and **Saltmarsh Crossing** (southeast, over a tributary).

Because the script *finds* its sites instead of bulldozing them, you can change the
seed at the top of `make-riverward.mjs` and regenerate: the war moves house — new river,
new bridges, new LZ — and every formation is still standing at the right kind of place.

## The defense (Cascara Home Guard, FWLM — `marik`)

- **Every bridgehead is a fortified post**: dug-in infantry, a Browning listening post
  (the eyes), a Partisan flak battery — and a **demo team** hiding beside the span with
  charges wired as a **standing rule** (D-049): *the moment our side holds a contact
  within 2 hexes, DEMOLISH the span.* Rules live on the unit and fire even off-net
  (D-046 — they react to what their own post can see), whatever the team is doing.
- **A recon satellite** sweeps the whole river corridor every few pulses. Columns
  moving on the crossings get sampled; the LZ itself sits just outside the track.
- **Riverwatch Station** (radar) on the hills behind Kingsbridge; the capital spaceport
  radar covers the home hex.
- **Port Cascara mounts a White Shark battery** (D-050): real capital-missile stats —
  48 air hexes of landing denial around the capital (extreme band), the reason the
  Rangers put down 70 hexes away. Eight missiles, then it is capture-or-nothing; an
  enemy ground formation standing on the port silences it.
- **The Long Tom battery** is laid on Kingsbridge's far approach and holds fire — a
  standing rule opens the registered mission the moment a battle erupts within 20 hexes.
- **The Po reserve company sits on the rail trunk**: 12 hexes/hour to either end of the
  line while everyone else walks.
- **The Verdigris command line** (D-048): 📡 relay masts strung down the road net —
  plus Riverwatch doubling as a relay — chain every bridgehead onto the capital's net,
  so the Guard can actually re-order its guards. Every mast is a target: drop one and
  everything downstream goes dark, running on standing orders and conditionals alone.
- A hover screen patrols the far bank; two mech lances anchor the capital and the near
  town; a hidden observation post overlooks the invaders' likely staging ground.

## The attack (10th Skye Rangers, LAAF — `skye`)

Grounded at the LZ with a beachhead dump: Rautenberg's command lance (Zeus, Banshee),
a cavalry lance, Bulldog armor, **hover cavalry** (Condors and Savannah Masters — the
river does not stop them; water is a hover highway), **Ferret scout VTOLs**, two Long
Tom batteries, flak, trains — and the **Pioneer Company**: a Prometheus Combat Support
Bridgelayer and an Engineering Vehicle. Two fighter flights wait on the Leopard CV's
deck.

Your problem: every gram of tracked and legged tonnage crosses the Verdigris at a
bridge, or not at all. Your tools:

1. **Take a bridge intact** — hover cavalry or battle armor by coup de main, fast,
   before the demo team's conditional trips. Their trigger needs *their side* to hold a
   contact within 2 hexes: kill the eyes first, or be quiet (MOVE_CAUTIOUS is the
   stealth pace — it slips, where a normal march checks its stride near enemy posts).
2. **Take the crossing loudly and rebuild** — let them blow it, clear the bank, and
   BUILD_BRIDGE from the shore (4 pulses). The span goes exactly where you click.
3. **Ignore the bridges** — hovers and VTOLs screen across the water while the mechs
   pin a bridgehead; or land the DropShips themselves on the far bank (flak permitting).
4. **Cut the command line** — the 📡 mast chain is how the Guard re-orders its
   bridgeheads. Drop a mast (or park ECM on it) and everything downstream goes dark:
   the demo teams are alone with their standing orders, and the reserve never gets the
   call. Relays radiate (SIG −1) — direction-finding the line is a recon mission.

## What this campaign showcases

| Mechanic | Where you'll meet it |
| --- | --- |
| Generated continents (D-041/D-044) | the whole map: the great river, passes, banks |
| Adaptive scenario placement (D-047) | change the seed; the script re-sites the war |
| Engineer toolkit as player orders (D-045) | DEMOLISH / BUILD_BRIDGE from the picker |
| Demolition from the bank | demo teams beside their spans, charges on a click |
| Standing rules off-net (D-046/D-049) | the wired spans fire without a command net |
| Plans — queued orders (D-049) | march → dig in → rest, plotted in three clicks |
| Command relays (D-048) | the mast line to the bridges — hold it, jam it, or cut it |
| Movement to contact (D-046) | columns check their stride at the outpost line |
| Artillery FIRE missions (D-045) | the registered battery behind Kingsbridge |
| Rail operational movement (D-037) | the Po reserve riding the trunk |
| Hover/VTOL motion families (D-036) | the Loch Riders crossing where no bridge is |
| Recon satellites | the river-corridor sweep that starts the clock |
| Anti-capital landing denial (D-050) | the White Shark battery that forced the cold LZ |
| Auto-routing + ETA (D-041) | every march you plot around that river |

## GM notes

- The **acceptance test** (`test/acceptance/riverward.test.ts`) plays the canonical
  opening: assault marches on the capital → satellite tips the guard → Argent Span
  drops in the column's face → pioneers bridge the gap → battle at the bridgehead.
  If you change the seed, run it — it derives everything from the file and will tell
  you if the new geography still tells the story.
- Bridgehead objectives sit on the **near-bank approach**, not the span: holding the
  crossing means holding its ground. Full hold is ~13 VP/day for the Guard; the
  campaign runs 30 days to a 170 VP threshold.
- The demo teams will fire on ANY qualifying contact — including a hover screen buzzing
  the far approach. A blown bridge is gone for both sides; the Guard's own counter-
  attack routes are on the line too. That is the game.
- Both sides have engineers. Nothing stops the Guard from dropping a NEW span behind a
  counter-attack, or the Rangers from mining a bridgehead they cannot hold.
