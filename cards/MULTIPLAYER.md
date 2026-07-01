# Live multiplayer (battle tracker)

Online battle is powered by [Supabase Realtime](https://supabase.com/realtime)
(free tier). The backend is **baked into the app** (`src/web/mp-config.ts`), so
once it's set up, **everyone who opens the site can play online with zero setup**
— no accounts, no server to run, no per-player configuration.

It only carries the two forces + per-unit damage between the two players. There's
no database and no login.

## One-time setup (site owner only — ~5 minutes, no terminal)

You only do this once, ever. After it's committed, it ships with every GitHub
Pages deploy and works for all your players.

1. Go to **[supabase.com](https://supabase.com/)** → sign in with GitHub →
   **New project**. Pick the **free** plan, any name, a region near you. Wait
   ~2 minutes for it to provision.
2. In the project, open **⚙ Project Settings → API**.
3. Copy two values into `src/web/mp-config.ts`:
   - **Project URL** (e.g. `https://abcdxyz.supabase.co`) → `SUPABASE_URL`
   - **anon public** key (the long string) → `SUPABASE_ANON_KEY`
4. Commit and push. The normal GitHub Pages build picks it up.

> The **anon public** key is designed to live in browser code — it's safe to
> commit. Supabase rate-limits and (optionally) Row Level Security protect the
> project; for a hobby battle relay that carries only forces + damage, the
> defaults are fine.

## Playing (everyone — no setup)

In the app: **⚔ Battle**.

- **Host online**: pick your force, **Start**. You get a **room link** — send it
  to your opponent (chat/Discord/etc.).
- **Join online**: paste the room link (or code) your opponent sent, pick your
  force, **Start**.

Both players now see the same battle: your force vs theirs. Mark damage / heat /
ammo / out-of-action on any unit and it updates on the other screen in real time.
Refreshing re-syncs from your opponent; the room stays alive as long as someone's
connected.

## Notes / limits

- Forces are exchanged peer-to-peer when the second player joins (a "hello"
  handshake); there's no server-side state. If both players are mid-battle and
  both refresh at the same instant, just have one re-open the room link.
- Damage is last-write-wins per unit — fine for turn-based play. No turn /
  initiative enforcement.
- Free-tier Realtime is plenty for a hobby group. If you ever outgrow it, any
  Supabase project (or self-hosted Supabase) works — just swap the two values in
  `src/web/mp-config.ts`.
