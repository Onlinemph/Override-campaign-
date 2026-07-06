/**
 * scripts/make-dist.mjs — build unzip-and-run release folders (D-054).
 *
 *   npm run dist                          # all targets
 *   npm run dist -- --targets=win-x64     # just one
 *
 * Each zip is a portable install: the server bundled to ONE plain-JS file (no
 * npm, no tsx, no node_modules), the UI pages, the demo campaigns, the built
 * card-builder web app (which carries the whole unit library), an official
 * Node.js runtime for the platform, and a double-clickable start script.
 *
 * Layout inside the zip (chosen so every `join(here, ...)` in the source
 * resolves unchanged — the bundle sits two levels deep, exactly like
 * src/server/index.ts does in the repo):
 *
 *   override-<version>-<target>/
 *     Start OVERRIDE.bat | start.sh
 *     README.txt · HOSTING.md
 *     node/            ← official Node runtime (node.exe or bin/node)
 *     lib/server/override.mjs
 *     lib/ui/…         ← ../ui from the bundle
 *     demo/…           ← ../../demo from the bundle
 *     cards/dist-web/… ← ../../cards/dist-web from the bundle
 *     campaigns/       ← saves land here (git-nothing, user data)
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
         chmodSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// D-054.3: THE TAG IS THE VERSION. Releases are created by tagging in the GitHub
// UI, and package.json will never be bumped in lockstep — so a tag build derives
// the version from the tag itself (v0.1.2 → 0.1.2). That keeps the zip's baked
// version, VERSION file, and asset names in agreement with the release tag, which
// is what the update beacon and the updater compare against. package.json is the
// fallback for local/branch builds only.
const VERSION = process.env.OVERRIDE_DIST_VERSION
  ?? (/^v\d/.test(process.env.GITHUB_REF_NAME ?? '') ? process.env.GITHUB_REF_NAME.slice(1) : null)
  ?? pkg.version;

// Pinned runtime (LTS). Override with OVERRIDE_DIST_NODE=22.x.y if you need to.
const NODE_VERSION = process.env.OVERRIDE_DIST_NODE ?? '22.12.0';

const ALL_TARGETS = ['win-x64', 'linux-x64', 'darwin-arm64', 'darwin-x64'];
const argTargets = process.argv.find(a => a.startsWith('--targets='));
const TARGETS = argTargets ? argTargets.split('=')[1].split(',') : ALL_TARGETS;
for (const t of TARGETS) {
  if (!ALL_TARGETS.includes(t)) { console.error(`unknown target ${t}`); process.exit(1); }
}

const releaseDir = join(root, 'release');
const cacheDir = join(root, '.cache/node-runtimes');
mkdirSync(releaseDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

// ── 0. preconditions ─────────────────────────────────────────────────────────
if (!existsSync(join(root, 'cards/dist-web/units-index.json'))) {
  console.error('cards/dist-web is not built (the unit library ships inside it).');
  console.error('Run `npm run setup` once, then retry.');
  process.exit(1);
}

// ── 1. bundle the server: all our TS + ws, one plain ESM file ───────────────
console.log('bundling server…');
const esbuild = await import('esbuild');
const bundleOut = join(releaseDir, 'override.mjs');
await esbuild.build({
  entryPoints: [join(root, 'src/server/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: bundleOut,
  // ws's optional native accelerators — its own try/catch handles their absence
  external: ['bufferutil', 'utf-8-validate'],
  // D-054.1: packaged builds know their version — the update beacon keys off this
  define: { __OVERRIDE_VERSION__: JSON.stringify(VERSION) },
  // CJS deps (ws) require() node builtins at runtime; in ESM output esbuild needs
  // a real require in scope or those calls throw "Dynamic require is not supported".
  banner: { js: [
    '// OVERRIDE GM Tool — bundled server. Do not edit; built by scripts/make-dist.mjs',
    "import { createRequire as __createRequire } from 'node:module';",
    'const require = __createRequire(import.meta.url);',
  ].join('\n') },
  logLevel: 'warning',
});

// ── 2. fetch node runtimes (cached) ──────────────────────────────────────────
function fetchRuntime(target) {
  const archive = {
    'win-x64': `node-v${NODE_VERSION}-win-x64.zip`,
    'linux-x64': `node-v${NODE_VERSION}-linux-x64.tar.xz`,
    'darwin-arm64': `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    'darwin-x64': `node-v${NODE_VERSION}-darwin-x64.tar.gz`,
  }[target];
  const cached = join(cacheDir, archive);
  if (!existsSync(cached)) {
    console.log(`downloading ${archive}…`);
    // One reset connection killed release v0.1.6 with three of four zips already
    // built: retry hard, and download to a temp name so a cut mid-transfer can't
    // leave a truncated archive in the cache to poison every later build.
    const part = `${cached}.part`;
    rmSync(part, { force: true });
    execFileSync('curl', ['-fsSL', '--retry', '4', '--retry-delay', '2',
      '--retry-all-errors', '-o', part,
      `https://nodejs.org/dist/v${NODE_VERSION}/${archive}`], { stdio: 'inherit' });
    renameSync(part, cached);
  }
  return cached;
}

/** Extract just the node binary out of the runtime archive into `destDir`. */
function installRuntime(target, archivePath, destDir) {
  mkdirSync(destDir, { recursive: true });
  const inner = archivePath.split(/[\\/]/).pop().replace(/\.(zip|tar\.(xz|gz))$/, '');
  if (target === 'win-x64') {
    // Windows hosts have no `unzip`, but their tar.exe (bsdtar) reads zips fine
    if (process.platform === 'win32') {
      execFileSync('tar', ['-xf', archivePath, '-C', destDir, `${inner}/node.exe`]);
    } else {
      execFileSync('unzip', ['-qo', archivePath, `${inner}/node.exe`, '-d', destDir]);
    }
    cpSync(join(destDir, inner, 'node.exe'), join(destDir, 'node.exe'));
    rmSync(join(destDir, inner), { recursive: true });
  } else {
    execFileSync('tar', ['-xf', archivePath, '-C', destDir, `${inner}/bin/node`]);
    mkdirSync(join(destDir, 'bin'), { recursive: true });
    cpSync(join(destDir, inner, 'bin/node'), join(destDir, 'bin/node'));
    chmodSync(join(destDir, 'bin/node'), 0o755);
    rmSync(join(destDir, inner), { recursive: true });
  }
}

// ── 3. start scripts & quickstart ────────────────────────────────────────────
const BAT = `@echo off\r
chcp 65001 >nul\r
cd /d "%~dp0"\r
if not exist campaigns mkdir campaigns\r
echo Starting OVERRIDE GM Tool ... close this window to stop the server.\r
.\\node\\node.exe lib\\server\\override.mjs --log campaigns\\campaign.jsonl %*\r
pause\r
`;
const SH = `#!/bin/sh
cd "$(dirname "$0")"
mkdir -p campaigns
exec ./node/bin/node lib/server/override.mjs --log campaigns/campaign.jsonl "$@"
`;
const UPDATE_BAT = `@echo off\r
chcp 65001 >nul\r
cd /d "%~dp0"\r
echo Make sure the OVERRIDE server window is CLOSED, then\r
pause\r
.\\node\\node.exe lib\\update.mjs %*\r
pause\r
`;
const UPDATE_SH = `#!/bin/sh
cd "$(dirname "$0")"
echo "Make sure the OVERRIDE server is stopped first."
exec ./node/bin/node lib/update.mjs "$@"
`;
const README = `OVERRIDE GM Tool v${VERSION}
=================================

A double-blind campaign manager for tabletop BattleTech.

QUICK START
  Windows:   double-click "Start OVERRIDE.bat"
  Mac/Linux: run ./start.sh

The window that opens prints your links:
  - the GM screen (yours), and
  - one player link PER SIDE, each carrying its own access token.
Share each side's link with that side only. Players just open it in a
browser — nothing to install.

Your campaign saves to campaigns\\campaign.jsonl automatically and resumes
when you restart. Back that file up and you've backed up the whole war.

To pick a different scenario (Operation RIVERWARD, DAGGERPOINT, or your
own), open the GM screen and use the campaign picker — or start with:
  Start OVERRIDE.bat demo\\riverward.json

Playing with friends over the internet: read HOSTING.md.
The full rules live in the in-app field manual (📘 on every screen).

UPDATING: the GM screen shows a banner when a newer release is on GitHub.
Close the server, run "Update OVERRIDE.bat" (or ./update.sh) — your saves in
campaigns\ are kept — then start as usual.
`;

// ── 4. assemble + zip each target ────────────────────────────────────────────
for (const target of TARGETS) {
  const name = `override-${VERSION}-${target}`;
  const stage = join(releaseDir, name);
  console.log(`staging ${name}…`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, 'lib/server'), { recursive: true });

  cpSync(bundleOut, join(stage, 'lib/server/override.mjs'));
  cpSync(join(root, 'src/ui'), join(stage, 'lib/ui'), { recursive: true });
  cpSync(join(root, 'demo'), join(stage, 'demo'), { recursive: true });
  cpSync(join(root, 'cards/dist-web'), join(stage, 'cards/dist-web'), { recursive: true });
  mkdirSync(join(stage, 'campaigns'), { recursive: true });
  writeFileSync(join(stage, 'campaigns/put-your-saves-here.txt'),
    'Campaign event logs land in this folder. Each .jsonl file is a complete,\n' +
    'replayable war — copy it to back it up, delete it to start fresh.\n');
  cpSync(join(root, 'docs/HOSTING.md'), join(stage, 'HOSTING.md'));
  writeFileSync(join(stage, 'README.txt'), README);
  writeFileSync(join(stage, 'VERSION'), VERSION + '\n');
  cpSync(join(root, 'scripts/release-update.mjs'), join(stage, 'lib/update.mjs'));

  if (target === 'win-x64') {
    writeFileSync(join(stage, 'Start OVERRIDE.bat'), BAT);
    writeFileSync(join(stage, 'Update OVERRIDE.bat'), UPDATE_BAT);
  } else {
    writeFileSync(join(stage, 'start.sh'), SH);
    chmodSync(join(stage, 'start.sh'), 0o755);
    writeFileSync(join(stage, 'update.sh'), UPDATE_SH);
    chmodSync(join(stage, 'update.sh'), 0o755);
  }
  installRuntime(target, fetchRuntime(target), join(stage, 'node'));

  console.log(`zipping ${name}.zip…`);
  rmSync(join(releaseDir, `${name}.zip`), { force: true });
  if (process.platform === 'win32') {
    // bsdtar picks the zip format from the extension; no `zip` CLI on Windows
    execFileSync('tar', ['-acf', `${name}.zip`, name], { cwd: releaseDir });
  } else {
    execFileSync('zip', ['-qry', `${name}.zip`, name], { cwd: releaseDir });
  }
  rmSync(stage, { recursive: true });
}

rmSync(bundleOut, { force: true });
console.log('\nrelease/ now contains:');
for (const f of readdirSync(releaseDir).filter(f => f.endsWith('.zip'))) {
  console.log(`  ${f}`);
}
