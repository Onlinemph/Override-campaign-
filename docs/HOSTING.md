# Hosting the GM Tool online

Three ways to get the campaign in front of your players, from "game night in two
minutes" to "always-on server". In every case the golden rule is:

> **Set a GM passphrase before exposing the server** (`--gm-key` or the
> `OVERRIDE_GM_KEY` env var). Player links are token-gated, but without a GM key
> anyone with the URL can open `/gm` and see the whole truth — fog of war and all.

Useful env vars (all optional, CLI flags win):

| var | what |
|---|---|
| `PORT` | listen port (default 8420) |
| `OVERRIDE_GM_KEY` | passphrase gating `/gm`, `/editor`, `/audit`, `/api/gm/*` |
| `OVERRIDE_LOG` | path to the JSONL event log — **this file IS your campaign**; persist it |
| `OVERRIDE_CAMPAIGN` | campaign json to start from (default `demo/campaign.json`) |

## 1. Game night — a free tunnel from your own PC (2 minutes)

Run the server on your machine and give it a temporary public URL. Nothing to
deploy, nothing to pay for; the URL lives as long as the tunnel runs.

```powershell
# once:
winget install Cloudflare.cloudflared

# each game night — terminal 1 (the server, with a key and a persistent log):
npm run dev -- demo/campaign.json --log war.jsonl --gm-key YOUR-SECRET

# terminal 2 (the tunnel):
cloudflared tunnel --url http://localhost:8420
```

`cloudflared` prints a `https://something.trycloudflare.com` URL. Your GM screen is
`<url>/gm` (it will ask for the passphrase); hand players their tokenized links from
the GM screen's link list, with the tunnel URL swapped in for `localhost:8420`.

Caveats: the URL changes every time you restart the tunnel, and your PC must stay
on. Perfect for sessions; annoying for a weeks-long campaign players check daily.

## 2. Always-on — Railway (~$5/month, no ops)

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

## 3. Docker — Fly.io, Render, or any VPS

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

## Backups & campaign life

The entire campaign is one append-only file: whatever `OVERRIDE_LOG` points at.
Copy that file and you have a full backup — replaying it reproduces the campaign
byte-exactly (including the audit trail and every die roll). Download it
periodically; restore by putting it back and restarting.

WebSockets (live map updates) work through all three setups — Cloudflare tunnels,
Railway, Fly, and Caddy all pass them through by default.
