@echo off
setlocal
set "ROOT=%~dp0"
set "PYTHONPATH=%ROOT%src"
set "PUBG_SUITE_ROOT=%ROOT%"
set "PUBG_SUITE_SAVE_ROOT=%ROOT%ALL GENERATED IMAGES"
set "PUBG_WEAPON_ASSETS_DIR=%ROOT%Add or Remove Gun Images Here"
echo Launching PUBG Madison AI Suite...
python -m pubg_madison_ai_suite.cli %*
if errorlevel 1 (
  echo ERROR: Launcher exited with code %errorlevel%.
  pause
)
endlocal
