@echo off
title Madison AI Suite — Launcher
echo ========================================
echo   Madison AI Suite — Starting...
echo ========================================
echo.

:: Kill any existing processes on our ports
echo [1/4] Cleaning up old processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8420 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Set environment variables
echo [2/4] Setting environment...
set PYTHONPATH=%~dp0src
set PUBG_SUITE_SAVE_ROOT=%~dp0ALL GENERATED IMAGES
set PUBG_SUITE_ROOT=%~dp0

:: Start backend
echo [3/4] Starting backend (port 8420)...
start "Madison-Backend" /min cmd /c "cd /d %~dp0 && python -m uvicorn pubg_madison_ai_suite.api.server:app --host 127.0.0.1 --port 8420"

:: Wait for backend to be ready
echo      Waiting for backend...
:wait_backend
timeout /t 1 /nobreak >nul
powershell -Command "try { (Invoke-WebRequest -Uri http://127.0.0.1:8420/api/system/health -UseBasicParsing -TimeoutSec 2).StatusCode } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait_backend
echo      Backend ready.

:: Start frontend dev server
echo [4/4] Starting frontend (port 5173)...
start "Madison-Frontend" /min cmd /c "cd /d %~dp0frontend && npx vite --host 127.0.0.1"

:: Wait for frontend to be ready
echo      Waiting for frontend...
:wait_frontend
timeout /t 1 /nobreak >nul
powershell -Command "try { (Invoke-WebRequest -Uri http://127.0.0.1:5173 -UseBasicParsing -TimeoutSec 2).StatusCode } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait_frontend
echo      Frontend ready.

echo.
echo ========================================
echo   Launching Madison AI Suite (Electron)
echo ========================================
echo.

:: Launch Electron app
cd /d %~dp0frontend
npx electron ../electron/main.js
