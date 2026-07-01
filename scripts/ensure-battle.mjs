#!/usr/bin/env node
/**
 * ensure-battle.mjs — make sure the embedded battle tracker (cards/dist-web) is
 * built so the GM server can serve /battle. Idempotent and non-fatal: if it's
 * already built we exit instantly; if the build fails we warn and carry on so a
 * hiccup never blocks `npm run dev` or a session start. Cross-platform (Node).
 */
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const built = join(root, 'cards', 'dist-web', 'index.html');

if (existsSync(built)) process.exit(0);

console.log('[battle] building the /battle tracker (first run; this can take a minute)…');
try {
  execSync('npm run build:battle', { cwd: root, stdio: 'inherit' });
  console.log('[battle] ready.');
} catch {
  console.warn('[battle] build failed — run `npm run build:battle` manually to enable /battle.');
}
process.exit(0);
