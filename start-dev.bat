@echo off
rem One-click launcher: opens backend + frontend dev windows.
rem Bypass here also fixes "npm.ps1 cannot be loaded" for the child shells.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1" %*
pause
