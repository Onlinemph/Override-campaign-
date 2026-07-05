# Hosting OVERRIDE — having people join your war

The GM Tool is a web server. Players never install anything: joining means
opening the link you hand them in a browser. This guide runs from "game night
in two minutes" to "always-on server". In every case the golden rule is:

> **Set a GM passphrase before exposing the server** (`--gm-key` or the
> `OVERRIDE_GM_KEY` env var). Player links are token-gated, but without a GM key
> anyone with the URL can open `/gm` and see the whole truth — fog of war and all.

## The links

When the server starts it prints a banner like:

```
┌─ OVERRIDE GM Tool ──────────────────────────────────────────
│ GM screen   http://192.168.1.42:8420/gm
│ Skye        http://192.168.1.42:8420/player/skye/k3j2…
│ Marik       http://192.168.1.42:8420/player/marik/9fa1…
```

- **The GM screen is yours.** It shows the whole truth — never share it.
- **Each player link carries its own access token** (the long suffix), derived
  from the campaign seed. Share each side's link with that side *only*; the
  tokens are stable across restarts, so a link keeps working all campaign.

Useful env vars (all optional, CLI flags win):

| var | what |
|---|---|
| `PORT` | listen port (default 8420) |
| `OVERRIDE_GM_KEY` | passphrase gating `/gm`, `/editor`, `/audit`, `/api/gm/*` |
| `OVERRIDE_LOG` | path to the JSONL event log — **this file IS your campaign**; persist it |
| `OVERRIDE_CAMPAIGN` | campaign json to start from (default `demo/campaign.json`) |
| `OVERRIDE_AUTOPACE` | minutes per automatic clock step (async play) |

## 0. Your own PC — the portable release (game night & LAN)

Download the release zip for your platform (or build one: `npm run dist`),
unzip anywhere, and:

- **Windows**: double-click **`Start OVERRIDE.bat`**
- **Mac/Linux**: `./start.sh`

No Node, no npm — the runtime ships in the box. The banner prints your LAN
links; anyone **on your wifi** can open them as-is. The start script already
persists the war to `campaigns\campaign.jsonl` and resumes it on restart.

- If a player's browser can't reach the link, it's almost always the firewall:
  allow `node.exe` inbound when Windows prompts (choose "Private networks").
- Different scenario: use the GM screen's campaign picker, or
  `Start OVERRIDE.bat demo\riverward.json`.
- Extra flags pass straight through: `Start OVERRIDE.bat --gm-key my-phrase`.

## 1. Friends over the internet — Tailscale (recommended for campaigns)

[Tailscale](https://tailscale.com) is a free private network between your
devices and your friends'. No router configuration, nothing exposed to the
public internet, addresses that never change — the right fit for a war that
runs for weeks.

1. You and each player install Tailscale and sign in.
2. Invite your players to your tailnet (admin console → Users → Invite), or
   use **Share machine** on the hosting PC.
3. Your machine gets a stable address (`100.x.y.z`, plus a name like
   `your-pc.tailnet.ts.net`). Hand out the same banner links with that address
   in place of the LAN IP.

The server itself needs no changes. Set a `--gm-key` anyway — good hygiene.

## 2. Game night with zero installs for players — a free tunnel (2 minutes)

Give your locally-running server a temporary public URL. Players need nothing
but the link; **the GM key is mandatory here**.

```powershell
# once:
winget install Cloudflare.cloudflared

# each game night — terminal 1 (the server, with a key):
Start OVERRIDE.bat --gm-key YOUR-SECRET        # or: npm run dev -- --log war.jsonl --gm-key YOUR-SECRET

# terminal 2 (the tunnel):
cloudflared tunnel --url http://localhost:8420
```

`cloudflared` prints a `https://something.trycloudflare.com` URL. Your GM
screen is `<url>/gm` (it asks for the passphrase); hand players their
tokenized links with the tunnel URL swapped in for the LAN address.
(`ngrok http 8420` works the same way.)

Caveats: the URL changes every time you restart the tunnel, and your PC must
stay on. Perfect for sessions; use Tailscale or a hosted deploy for a
weeks-long campaign players check daily.

## 3. Always-on — Railway (~$5/month, no ops)

[Railway](https://railway.app) deploys straight from your GitHub repo and gives the
campaign a permanent URL players can check between sessions.

1. New Project → **Deploy from GitHub repo** → pick this repository. It detects
   Node and runs `npm start` (the first boot builds the battle tracker — give it a
   couple of minutes).
2. Add a **Volume** mounted at `/data` (this is what makes the campaign survive
   redeploys).
3. Under Variables set:
   - `OVERRIDE_GM_KEY` = your passphrase
   - `OVERRIDE_LOG` = `/data/war.jsonl`
4. Settings → Networking → **Generate Domain**. Done: `https://<your-app>.up.railway.app/gm`.

To start from your own campaign instead of the demo, commit your json to the repo
and set `OVERRIDE_CAMPAIGN` to its path — or just use the GM screen's campaign
switcher / `/editor` once it's up.

## 4. Docker — Fly.io, Render, or any VPS

A `Dockerfile` ships in the repo root; the image is self-contained (the unit
library is vendored — no network needed at build).

```sh
docker build -t override-gm .
docker run -d -p 8420:8420 -v override-data:/data \
  -e OVERRIDE_GM_KEY=change-me override-gm
```

On **Fly.io**: `fly launch` (it picks up the Dockerfile), then
`fly volumes create override_data --size 1` and add to `fly.toml`:

```toml
[mounts]
  source = "override_data"
  destination = "/data"

[env]
  OVERRIDE_LOG = "/data/war.jsonl"
```

then `fly secrets set OVERRIDE_GM_KEY=change-me` and `fly deploy`.

On a plain VPS, put a reverse proxy (Caddy makes HTTPS one line:
`your.domain { reverse_proxy localhost:8420 }`) in front and run the container
under `--restart unless-stopped`.

## 5. Classic port forwarding

Forward external port 8420 → your machine's LAN IP:8420 in your router and
share `http://<your-public-IP>:8420/…` links. It works, but it exposes your
home IP and an open port to the world — set `--gm-key`, and prefer 1–4.

## The slow war — async play (players drop in anytime)

Hosted campaigns really shine played **asynchronously**: the war runs continuously,
players open their link whenever life allows, read their inbox, plot orders, and get
pinged when something needs them. Three switches turn it on:

1. **Autopace** — the clock advances itself. Set `OVERRIDE_AUTOPACE=30` (one step every
   30 real minutes) or use the GM screen's **⏱ Autopace** control to tune it live. The
   clock pauses automatically while an engagement is frozen (that's battle night — resolve
   it in the tracker and the war resumes) and when the campaign ends. Orders players plot
   take effect on the next tick, exactly as in live play.
2. **Discord pings** — create a webhook per side channel (Discord → channel settings →
   Integrations → Webhooks) and set:
   ```
   OVERRIDE_WEBHOOK_BLUE=https://discord.com/api/webhooks/…   # one per side id
   OVERRIDE_WEBHOOK_RED=https://discord.com/api/webhooks/…
   OVERRIDE_WEBHOOK_GM=https://discord.com/api/webhooks/…     # the spectator feed
   ```
   Each side is pinged only with what its own screens would show — delivered contact
   reports, its repairs/refits completing, BINGO fuel calls, and the engagements it is
   party to. **Fog of war holds in Discord**: red never sees blue's reports. The GM feed
   gets the who-vs-who on engagements, results, and endings.
3. **Persistence** — you already have it (the start script's `--log`, or `OVERRIDE_LOG`
   on a volume). The war survives restarts mid-campaign; autopace and webhooks
   reconnect on boot.

A good cadence for a weeks-long campaign: autopace 60 (one step per real hour ≈ a game
day every day or two), players check Discord like a play-by-mail game, and the group
gathers only when the ⚔ ping lands.

## Backups & campaign life

The entire campaign is one append-only file: whatever your `--log` /
`OVERRIDE_LOG` points at. Copy that file and you have a full backup — replaying
it reproduces the campaign byte-exactly (including the audit trail and every
die roll). Download it periodically; restore by putting it back and restarting.

Updating to a new release: unzip it fresh, copy your `campaigns/` folder
across, start — logs are append-only and replay through the new engine (check
release notes for anything flagged save-breaking).

WebSockets (live map updates) work through all of these setups — Cloudflare
tunnels, Tailscale, Railway, Fly, and Caddy all pass them through by default.
