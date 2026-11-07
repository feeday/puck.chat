@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul
title Puck Chat - Update

echo.
echo ==========================================
echo            Puck Chat - Update
echo ==========================================
echo.

if not exist ".git" (
    echo [ERROR] This folder is not a Git clone.
    echo Download the latest ZIP or clone the repository first.
    echo https://github.com/feeday/puck.chat
    goto FAILED
)

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git was not found. Install Git for Windows:
    echo https://git-scm.com/download/win
    goto FAILED
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found. Run install.bat first.
    goto FAILED
)

for /f "tokens=1 delims=v." %%A in ('node -v 2^>nul') do set "NODE_MAJOR=%%A"
if not defined NODE_MAJOR goto FAILED
if %NODE_MAJOR% LSS 20 (
    echo [ERROR] Node.js 20 or newer is required. Run install.bat first.
    goto FAILED
)

echo [INFO] Pulling the latest code...
git pull --ff-only
if errorlevel 1 (
    echo.
    echo [ERROR] Update stopped. Your local changes may need to be committed or stashed.
    goto FAILED
)

echo.
echo [INFO] Updating npm dependencies...
call npm.cmd install
if errorlevel 1 goto NPM_FAILED

echo.
echo [INFO] Checking server.js syntax...
node --check server.js
if errorlevel 1 goto CHECK_FAILED

echo.
echo [OK] Puck Chat is up to date.
echo Run start.bat to launch the updated version.
echo Your .env file is preserved.
echo.
pause
exit /b 0

:NPM_FAILED
echo [ERROR] npm install failed.
goto FAILED

:CHECK_FAILED
echo [ERROR] server.js syntax check failed.
goto FAILED

:FAILED
echo.
pause
exit /b 1
