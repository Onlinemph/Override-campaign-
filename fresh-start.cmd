@echo off
REM ── Double-click for a CLEAN playtest: stop, wipe the save, start fresh ─────
cd /d "%~dp0"
node scripts\kill-port.mjs
del /q war.jsonl 2>nul
echo Starting a fresh campaign  (close this window or press Ctrl+C to stop)...
npm run dev -- demo/starter.json --log war.jsonl --gm-key pellar
echo.
echo Server stopped.
pause
