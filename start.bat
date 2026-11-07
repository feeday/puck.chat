@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul
title Puck Chat

echo.
echo ==========================================
echo              Puck Chat
echo ==========================================
echo.

where node >nul 2>&1
if errorlevel 1 goto RUN_INSTALLER

for /f "tokens=1 delims=v." %%A in ('node -v 2^>nul') do set "NODE_MAJOR=%%A"
if not defined NODE_MAJOR goto NODE_ERROR
if %NODE_MAJOR% LSS 20 goto NODE_TOO_OLD

if not exist "node_modules\express\package.json" (
    echo [INFO] Dependencies are missing. Running npm install...
    call npm.cmd install
    if errorlevel 1 goto NPM_FAILED
)

if not exist ".env" (
    if exist ".env.example" (
        copy /Y ".env.example" ".env" >nul
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='.env'; $s=Get-Content -Raw -LiteralPath $p; $s=$s -replace '(?m)^HOST=0\.0\.0\.0\s*$', 'HOST=127.0.0.1'; [System.IO.File]::WriteAllText((Resolve-Path $p), $s, [System.Text.Encoding]::ASCII)"
        echo [OK] Created local .env
    )
)

set "PUCK_PORT=3000"
if exist ".env" (
    for /f "tokens=1,* delims==" %%A in ('findstr /b "PORT=" ".env" 2^>nul') do set "PUCK_PORT=%%B"
)
if not defined PUCK_PORT set "PUCK_PORT=3000"

echo [OK] Node.js:
node -v
echo [INFO] Starting server at http://127.0.0.1:%PUCK_PORT%
echo [INFO] Keep this window open while using Puck Chat.
echo [INFO] Press Ctrl+C to stop the server.
echo.

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "$u='http://127.0.0.1:%PUCK_PORT%/api/health'; for($i=0;$i -lt 45;$i++){try{Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 1 | Out-Null; Start-Process 'http://127.0.0.1:%PUCK_PORT%/'; exit}catch{Start-Sleep -Seconds 1}}"
call npm.cmd start

echo.
echo [INFO] Puck Chat has stopped.
pause
exit /b 0

:RUN_INSTALLER
echo [ERROR] Node.js is not installed. Run install.bat first.
pause
exit /b 1

:NODE_TOO_OLD
echo [ERROR] Node.js 20 or newer is required. Run install.bat to upgrade.
node -v
pause
exit /b 1

:NODE_ERROR
echo [ERROR] Could not determine the Node.js version.
pause
exit /b 1

:NPM_FAILED
echo [ERROR] npm install failed.
pause
exit /b 1
