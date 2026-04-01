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

rem --- Ensure pip is available ---
python -m pip --version >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [SETUP] pip not found - bootstrapping pip...
    python -m ensurepip --upgrade 2>&1
    if !ERRORLEVEL! neq 0 (
        echo [SETUP] ensurepip failed - trying get-pip.py...
        python -c "import urllib.request; urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py', 'get-pip.py')" 2>&1
        python get-pip.py 2>&1
        if exist "get-pip.py" del "get-pip.py"
    )
    python -m pip --version >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo.
        echo [ERROR] Could not install pip. Please reinstall Python from
        echo         https://www.python.org/downloads/ and make sure to check
        echo         "Add Python to PATH" and do NOT uncheck "Install pip".
        pause
        exit /b 1
    )
    echo [SETUP] pip is ready.
    echo.
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

rem --- Kill stale processes on our ports ---
echo Cleaning up stale processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8420 " ^| findstr "LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

rem --- Launch ---
echo Starting Madison AI Suite...
echo.
cd /d "%~dp0frontend"
call npx electron ../electron/main.js

if !ERRORLEVEL! neq 0 (
    echo.
    echo [ERROR] Madison AI Suite exited with error code !ERRORLEVEL!
    pause
)
