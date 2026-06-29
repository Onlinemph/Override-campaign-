@echo off
REM ── Double-click to START the OVERRIDE server ──────────────────────────────
REM Edit the campaign file, log name, or GM passphrase on the line below.
cd /d "%~dp0"
echo Starting OVERRIDE  (close this window or press Ctrl+C to stop)...
npm run dev -- demo/starter.json --log war.jsonl --gm-key pellar
echo.
echo Server stopped.
pause
