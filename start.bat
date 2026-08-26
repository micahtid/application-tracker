@echo off
rem One click launcher for Windows. The steps themselves live in
rem scripts/launch.mjs, so every system runs the same four.

cd /d "%~dp0"
call npm run launch || pause
