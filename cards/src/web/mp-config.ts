/**
 * Baked-in multiplayer backend (Supabase Realtime).
 *
 * These are PUBLIC client credentials by design — the Supabase "anon" key is
 * meant to ship in browser code, so it's safe to commit here. It lets the app's
 * online battle work for everyone who opens the site, with zero setup on their
 * part. Set up once at supabase.com (free), paste the two values below, and it
 * deploys with the normal GitHub Pages build.
 *
 * To wire it up: Supabase project → Project Settings → API →
 *   - Project URL  → SUPABASE_URL
 *   - anon public  → SUPABASE_ANON_KEY
 */
export const SUPABASE_URL = "https://aivfdcjedwpuuenauljh.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpdmZkY2plZHdwdXVlbmF1bGpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNDU3NjAsImV4cCI6MjA5NzYyMTc2MH0.ULAUzMxUah3Wqh1w6YEisEBnktSS_8ISKRHhYHt-k7o";

/** True once real credentials have been filled in above. */
export const MP_CONFIGURED =
  /^https:\/\/[a-z0-9]+\.supabase\.co/.test(SUPABASE_URL) &&
  SUPABASE_ANON_KEY.length > 40 &&
  !SUPABASE_ANON_KEY.startsWith("PASTE_");
