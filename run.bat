@echo off
setlocal enabledelayedexpansion
title Madison AI Suite
echo ========================================
echo   Madison AI Suite
echo ========================================
echo.

cd /d "%~dp0"

rem --- Check for Python ---
python --version >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo         Download it from https://www.python.org/downloads/
    echo         Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)

rem --- Check for Node.js ---
node --version >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo         Download it from https://nodejs.org/
    pause
    exit /b 1
)

rem --- Install Python dependencies if needed ---
if not exist ".python_deps_installed" (
    echo [SETUP] Installing Python dependencies - first time setup...
    echo.
    python -m pip install -r requirements.txt
    if !ERRORLEVEL! neq 0 (
        echo.
        echo [ERROR] Failed to install Python dependencies.
        echo         Try running manually: python -m pip install -r requirements.txt
        pause
        exit /b 1
    )
    echo. > .python_deps_installed
    echo [SETUP] Python dependencies installed successfully.
    echo.
)

rem --- Install Node dependencies if needed ---
if not exist "frontend\node_modules" (
    echo [SETUP] Installing frontend dependencies - first time setup...
    echo.
    cd /d "%~dp0frontend"
    call npm install
    if !ERRORLEVEL! neq 0 (
        echo.
        echo [ERROR] Failed to install frontend dependencies.
        echo         Try running manually: cd frontend then npm install
        pause
        exit /b 1
    )
    cd /d "%~dp0"
    echo [SETUP] Frontend dependencies installed successfully.
    echo.
)

rem --- Verify backend can import ---
cd /d "%~dp0"
set "PYTHONPATH=%~dp0src"
python -c "from pubg_madison_ai_suite.api.server import app; print('[CHECK] Backend modules OK')" 2>&1
if !ERRORLEVEL! neq 0 (
    echo.
    echo [REPAIR] Backend check failed - reinstalling Python dependencies...
    echo.
    if exist ".python_deps_installed" del ".python_deps_installed"
    python -m pip install -r requirements.txt
    if !ERRORLEVEL! neq 0 (
        echo.
        echo [ERROR] Failed to install Python dependencies.
        echo         Try running manually: python -m pip install -r requirements.txt
        pause
        exit /b 1
    )
    echo. > .python_deps_installed
    echo.
    python -c "from pubg_madison_ai_suite.api.server import app; print('[CHECK] Backend modules OK after repair')" 2>&1
    if !ERRORLEVEL! neq 0 (
        echo.
        echo [ERROR] Backend still cannot load after reinstalling dependencies.
        echo         Check the error above for details.
        pause
        exit /b 1
    )
)

rem --- Launch ---
echo Starting Madison AI Suite...
echo.
cd /d "%~dp0frontend"
call npx electron ../electron/main.js
