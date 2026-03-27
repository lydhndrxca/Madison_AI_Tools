@echo off
setlocal
set "ROOT=%~dp0"
set "PYTHONPATH=%ROOT%src"
set "PUBG_SUITE_ROOT=%ROOT%"
set "PUBG_SUITE_SAVE_ROOT=%ROOT%ALL GENERATED IMAGES"
set "PUBG_WEAPON_ASSETS_DIR=%ROOT%Add or Remove Gun Images Here"
set "MADISON_API_PORT=8420"

echo ============================================
echo   PUBG Madison AI Suite v2.0 (Electron UI)
echo ============================================
echo.

cd /d "%ROOT%frontend"

:: Check if dist exists
if not exist "dist\index.html" (
    echo [!] Built frontend not found. Building now...
    call npx vite build
    echo.
)

echo Launching...
call npx electron "%ROOT%electron\main.js"

if errorlevel 1 (
    echo ERROR: App exited with code %errorlevel%.
    pause
)
endlocal
