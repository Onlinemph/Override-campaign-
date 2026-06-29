/**
 * Stop whatever is listening on the server port (default 8420). Cross-platform.
 * Used by `npm run stop` and the stop.cmd / fresh-start.cmd helpers.
 */
import { execSync } from 'node:child_process';

const port = process.env.PORT || '8420';
try {
  if (process.platform === 'win32') {
    const out = execSync(`netstat -ano | findstr :${port}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const pids = new Set();
    for (const line of out.split('\n')) {
      const m = line.match(/LISTENING\s+(\d+)/);
      if (m) pids.add(m[1]);
    }
    if (pids.size === 0) { console.log(`No server running on port ${port}.`); process.exit(0); }
    for (const pid of pids) execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
  } else {
    execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: 'ignore' });
  }
  console.log(`Stopped the OVERRIDE server on port ${port}.`);
} catch {
  console.log(`No server running on port ${port}.`);
}
