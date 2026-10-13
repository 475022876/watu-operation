@echo off
rem VFIB Marketing OS - start server accessible from LAN (0.0.0.0:9080)
cd /d "%~dp0"
set MOS_HOST=0.0.0.0
set MOS_PORT=9080
echo Starting VFIB Marketing OS on http://%COMPUTERNAME%:9080 (LAN accessible) ...
node server.js
