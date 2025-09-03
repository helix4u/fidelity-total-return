@echo off
REM Simple Windows runner... creates venv then launches app
setlocal
set ROOT=%~dp0
cd /d "%ROOT%"
py -3 bootstrap.py
