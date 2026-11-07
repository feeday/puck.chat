@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul
title Puck Chat - Install

echo.
echo ==========================================
echo          Puck Chat - Local Installer
echo ==========================================
echo.

where node >nul 2>&1
if errorlevel 1 goto INSTALL_NODE

for /f "tokens=1 delims=v." %%A in ('node -v 2^>nul') do set "NODE_MAJOR=%%A"
if not defined NODE_MAJOR goto NODE_ERROR
if %NODE_MAJOR% LSS 20 goto UPGRADE_NODE
goto CHECK_NPM

:INSTALL_NODE
echo [INFO] Node.js was not found. Installing Node.js LTS with winget...
where winget >nul 2>&1
if errorlevel 1 goto WINGET_MISSING
winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
if errorlevel 1 goto NODE_INSTALL_FAILED
goto REFRESH_PATH

:UPGRADE_NODE
echo [INFO] Node.js 20 or newer is required. Trying to upgrade Node.js LTS...
where winget >nul 2>&1
if errorlevel 1 goto NODE_TOO_OLD
winget upgrade --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
if errorlevel 1 goto NODE_UPGRADE_FAILED
goto REFRESH_PATH

:REFRESH_PATH
set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%APPDATA%\npm;%PATH%"
where node >nul 2>&1
if errorlevel 1 goto NODE_REFRESH_FAILED
for /f "tokens=1 delims=v." %%A in ('node -v 2^>nul') do set "NODE_MAJOR=%%A"
if not defined NODE_MAJOR goto NODE_ERROR
if %NODE_MAJOR% LSS 20 goto NODE_TOO_OLD

:CHECK_NPM
where npm >nul 2>&1
if errorlevel 1 goto NPM_MISSING

echo [OK] Node.js:
node -v
echo [OK] npm:
call npm.cmd -v
echo.

if not exist ".env" (
    if exist ".env.example" (
        copy /Y ".env.example" ".env" >nul
        echo [OK] Created .env from .env.example
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='.env'; $s=Get-Content -Raw -LiteralPath $p; $s=$s -replace '(?m)^HOST=0\.0\.0\.0\s*$', 'HOST=127.0.0.1'; [System.IO.File]::WriteAllText((Resolve-Path $p), $s, [System.Text.Encoding]::ASCII)"
    ) else (
        echo [WARN] .env.example was not found. The server will use its defaults.
    )
) else (
    echo [OK] Existing .env found. It will not be overwritten.
)

echo.
echo [INFO] Installing project dependencies...
call npm.cmd install
if errorlevel 1 goto NPM_INSTALL_FAILED

echo.
echo [OK] Installation completed.
echo [INFO] Starting Puck Chat...
echo.
call "%~dp0start.bat"
exit /b %ERRORLEVEL%

:WINGET_MISSING
echo [ERROR] winget is unavailable on this Windows installation.
echo Install Node.js 20 LTS or newer manually from:
echo https://nodejs.org/
goto FAILED

:NODE_INSTALL_FAILED
echo [ERROR] Node.js installation through winget failed.
echo Install Node.js 20 LTS or newer manually from:
echo https://nodejs.org/
goto FAILED

:NODE_UPGRADE_FAILED
echo [ERROR] Node.js upgrade failed. Please install Node.js 20 or newer manually:
echo https://nodejs.org/
goto FAILED

:NODE_REFRESH_FAILED
echo [ERROR] Node.js was installed, but this window cannot find it yet.
echo Close this window, open a new one, and run install.bat again.
goto FAILED

:NODE_TOO_OLD
echo [ERROR] Node.js 20 or newer is required.
echo Current version:
node -v
echo Please install the current Node.js LTS release from https://nodejs.org/
goto FAILED

:NODE_ERROR
echo [ERROR] Could not determine the Node.js version.
goto FAILED

:NPM_MISSING
echo [ERROR] npm was not found. Reinstall Node.js 20 or newer from https://nodejs.org/
goto FAILED

:NPM_INSTALL_FAILED
echo [ERROR] npm install failed. Check your network connection and try again.
goto FAILED

:FAILED
echo.
pause
exit /b 1
