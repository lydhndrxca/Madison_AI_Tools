@echo off
title Madison AI Suite
echo ========================================
echo   Madison AI Suite — Starting...
echo ========================================
echo.

cd /d %~dp0frontend
npx electron ../electron/main.js
