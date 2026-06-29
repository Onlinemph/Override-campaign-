@echo off
REM ── Double-click to STOP the OVERRIDE server (frees port 8420) ──────────────
cd /d "%~dp0"
node scripts\kill-port.mjs
timeout /t 2 >nul
