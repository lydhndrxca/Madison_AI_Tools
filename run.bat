@echo off
title Madison AI Suite
echo ========================================
echo   Madison AI Suite
echo ========================================
echo.

cd /d %~dp0

:: ── Check for Python ──────────────────────────────────────
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo         Download it from https://www.python.org/downloads/
    echo         Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)

:: ── Check for Node.js ─────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo         Download it from https://nodejs.org/
    pause
    exit /b 1
)

:: ── Install Python dependencies if needed ─────────────────
if not exist ".python_deps_installed" (
    echo [SETUP] Installing Python dependencies (first-time setup)...
    echo.
    pip install -r requirements.txt
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to install Python dependencies.
        echo         Try running: pip install -r requirements.txt
        pause
        exit /b 1
    )
    echo. > .python_deps_installed
    echo [SETUP] Python dependencies installed successfully.
    echo.
)

:: ── Install Node dependencies if needed ───────────────────
if not exist "frontend\node_modules" (
    echo [SETUP] Installing frontend dependencies (first-time setup)...
    echo.
    cd /d %~dp0frontend
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to install frontend dependencies.
        echo         Try running: cd frontend ^&^& npm install
        pause
        exit /b 1
    )
    cd /d %~dp0
    echo [SETUP] Frontend dependencies installed successfully.
    echo.
)

:: ── Launch ────────────────────────────────────────────────
echo Starting Madison AI Suite...
echo.
cd /d %~dp0frontend
npx electron ../electron/main.js
