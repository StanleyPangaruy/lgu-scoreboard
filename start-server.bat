@echo off
title Lopez Scoreboard Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul
if not errorlevel 1 (
  echo The scoreboard server is already running on port 3000.
  echo Close its other window first if you want to restart it.
  echo.
  pause
  exit /b 0
)

if not exist "node_modules\ws" (
  echo First run: installing what the server needs...
  call npm install
  if errorlevel 1 (
    echo.
    echo Install failed. Check the internet connection and run this again.
    pause
    exit /b 1
  )
)

rem Open the control panel in the default browser once the server has had time to start.
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000/control.html"

echo Keep this window open during the game. Close it to stop the server.
node server.js

echo.
echo The server has stopped.
pause
