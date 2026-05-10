@echo off
setlocal

cd /d "%~dp0"

echo Starting QE Wireframe Tool on http://localhost:7000

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not found in PATH.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

start "" "http://localhost:7000"
call npm.cmd run dev

if errorlevel 1 (
  echo Server stopped with an error.
  pause
  exit /b 1
)

endlocal
