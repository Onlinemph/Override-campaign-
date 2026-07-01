#!/usr/bin/env node
/**
 * update.mjs — one command to pull the latest and get running again:
 * fetch + fast-forward, reinstall deps, rebuild the battle tracker. Each step
 * streams its output; a failure stops with a clear message.
 */
import { execSync } from 'node:child_process';

const step = (label, cmd) => {
  console.log(`\n→ ${label}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    console.error(`\n✗ "${label}" failed. Fix the above, then re-run: npm run update`);
    process.exit(1);
  }
};

step('Pulling the latest changes', 'git pull --ff-only');
step('Installing dependencies', 'npm install');
step('Rebuilding the battle tracker', 'npm run build:battle');

console.log('\n✓ Up to date. Start it with:  npm run dev');
