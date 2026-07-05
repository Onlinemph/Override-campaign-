/**
 * server/update.ts — the update beacon (D-054.1).
 *
 * Packaged builds (the release zips) know their own version — esbuild bakes it
 * in at dist time. On boot, and once a day after, the server asks GitHub for
 * the latest release and surfaces "v0.2.0 is out" on the GM screen and in the
 * console. It NEVER updates itself while running: the zip ships an updater
 * (Update OVERRIDE.bat / update.sh) that swaps the app files between sessions,
 * preserving campaigns/ and the runtime.
 *
 * Dev checkouts (`npm run dev`) have no baked version — the check is off, and
 * `npm run update` (git pull + rebuild) is the path there.
 *
 * Private repos: unauthenticated release lookups 404. Either make the repo
 * public or set OVERRIDE_UPDATE_TOKEN to a read-only fine-grained token —
 * both the beacon and the updater honor it.
 */

export interface AppUpdate { current: string; latest: string; url: string }

/** "1.2.10" vs "1.3.0" — numeric, segment-wise; missing segments are 0. */
export function cmpVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => Number(n) || 0);
  const pb = b.split('.').map(n => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Ask GitHub for the newest release; null = up to date / unknown / offline. */
export async function checkLatestRelease(
  repo: string, currentVersion: string, token?: string,
): Promise<AppUpdate | null> {
  try {
    const headers: Record<string, string> = {
      'user-agent': 'override-gm-tool',
      accept: 'application/vnd.github+json',
    };
    if (token) headers.authorization = `Bearer ${token}`;
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`,
      { headers, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const rel = await r.json() as { tag_name?: string; html_url?: string };
    const latest = (rel.tag_name ?? '').replace(/^v/, '');
    if (!latest || cmpVersions(latest, currentVersion) <= 0) return null;
    return { current: currentVersion, latest,
             url: rel.html_url ?? `https://github.com/${repo}/releases/latest` };
  } catch {
    return null; // offline / rate-limited / private-without-token: silently fine
  }
}
