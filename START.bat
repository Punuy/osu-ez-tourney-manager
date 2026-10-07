@echo off
title mania-tourney
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22+ is required - install from https://nodejs.org && pause && exit /b 1)
start "" http://localhost:7272/panel
node server/index.js
pause
