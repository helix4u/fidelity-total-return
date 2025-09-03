@echo off
REM Launch the Node.js backend instead of the Python one
setlocal
set ROOT=%~dp0
cd /d "%ROOT%\node-app"
call npm install
call npm start
