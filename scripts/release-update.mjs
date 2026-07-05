/**
 * release-update.mjs — the in-box updater (D-054.1). Ships in every zip as
 * lib/update.mjs; run it via "Update OVERRIDE.bat" / "./update.sh" with the
 * server CLOSED.
 *
 * What it does: reads this install's VERSION, asks GitHub for the latest
 * release, downloads the matching platform zip, and swaps the APP files —
 * lib/, cards/, demo/, docs, start scripts, VERSION. What it never touches:
 * campaigns/ (your saves) and node/ (the runtime).
 *
 * Private repo? Set OVERRIDE_UPDATE_TOKEN to a read-only token; public repos
 * need nothing. OVERRIDE_UPDATE_REPO overrides the source repository.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync,
         writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'); // lib/ → install root
const REPO = process.env.OVERRIDE_UPDATE_REPO ?? 'onlinemph/Override-campaign-';
const TOKEN = process.env.OVERRIDE_UPDATE_TOKEN;

function cmpVersions(a, b) {
  const pa = a.split('.').map(n => Number(n) || 0);
  const pb = b.split('.').map(n => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const target = {
  'win32-x64': 'win-x64', 'linux-x64': 'linux-x64',
  'darwin-arm64': 'darwin-arm64', 'darwin-x64': 'darwin-x64',
}[`${process.platform}-${process.arch}`];
if (!target) { console.error(`No release target for ${process.platform}-${process.arch}`); process.exit(1); }

const versionFile = join(root, 'VERSION');
const current = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : '0.0.0';
console.log(`OVERRIDE updater — installed: v${current} (${target})`);

const headers = { 'user-agent': 'override-gm-tool-updater', accept: 'application/vnd.github+json' };
if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;

const relRes = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
if (!relRes.ok) {
  console.error(`Could not reach GitHub releases (HTTP ${relRes.status}).`);
  if (relRes.status === 404) {
    console.error('If the repository is private, set OVERRIDE_UPDATE_TOKEN to a read-only token.');
  }
  process.exit(1);
}
const rel = await relRes.json();
const latest = (rel.tag_name ?? '').replace(/^v/, '');
if (!latest || cmpVersions(latest, current) <= 0) {
  console.log(`Already up to date (latest release: v${latest || 'none'}).`);
  process.exit(0);
}
const asset = (rel.assets ?? []).find(a => a.name.endsWith(`-${target}.zip`));
if (!asset) {
  console.error(`v${latest} has no ${target} zip — download manually: ${rel.html_url}`);
  process.exit(1);
}

console.log(`Downloading v${latest} (${(asset.size / 1e6).toFixed(0)} MB)…`);
// asset.url + octet-stream works for BOTH public and private repos
const dl = await fetch(asset.url, {
  headers: { ...headers, accept: 'application/octet-stream' }, redirect: 'follow' });
if (!dl.ok) { console.error(`Download failed (HTTP ${dl.status}).`); process.exit(1); }
const tmp = join(root, 'update-tmp');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const zipPath = join(tmp, asset.name);
writeFileSync(zipPath, Buffer.from(await dl.arrayBuffer()));

console.log('Extracting…');
// Windows 10+ ships bsdtar (reads zip); mac's tar is bsdtar; linux prefers unzip
if (process.platform === 'linux') {
  try { execFileSync('unzip', ['-q', zipPath, '-d', tmp]); }
  catch { execFileSync('tar', ['-xf', zipPath, '-C', tmp]); }
} else {
  execFileSync('tar', ['-xf', zipPath, '-C', tmp]);
}
const inner = readdirSync(tmp).find(d => d.startsWith('override-') && !d.endsWith('.zip'));
if (!inner) { console.error('Unexpected zip layout.'); process.exit(1); }
const src = join(tmp, inner);

console.log('Swapping app files (campaigns/ and node/ are untouched)…');
for (const part of ['lib', 'cards', 'demo']) {
  rmSync(join(root, part), { recursive: true, force: true });
  cpSync(join(src, part), join(root, part), { recursive: true });
}
// NOTE: 'Update OVERRIDE.bat' is deliberately NOT overwritten — cmd re-reads a
// running batch file by byte offset, so self-replacement mid-run corrupts it.
// It only changes with a fresh zip download (it's a two-line delegator anyway).
for (const f of ['HOSTING.md', 'README.txt', 'VERSION', 'Start OVERRIDE.bat', 'start.sh',
                 'update.sh']) {
  if (existsSync(join(src, f))) cpSync(join(src, f), join(root, f));
}
rmSync(tmp, { recursive: true, force: true });
console.log(`Done — now running v${latest}. Start the server as usual; your campaigns resume.`);
