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
        echo [OK] Created local .env
    )
)

rem Make the Node server reachable from other devices on the local network.
if exist ".env" (
    node -e "const fs=require('fs');const p='.env';let s=fs.readFileSync(p,'utf8');if(/^\s*HOST\s*=/m.test(s)){s=s.replace(/^\s*HOST\s*=.*$/m,'HOST=0.0.0.0')}else{s=s.replace(/\s*$/,'')+'\r\nHOST=0.0.0.0\r\n'}fs.writeFileSync(p,s,'utf8');"
    if errorlevel 1 echo [WARN] Could not update HOST in .env. The server process will still use HOST=0.0.0.0.
)
set "HOST=0.0.0.0"

set "PUCK_PORT=3000"
if exist ".env" (
    for /f "tokens=1,* delims==" %%A in ('findstr /b "PORT=" ".env" 2^>nul') do set "PUCK_PORT=%%B"
)
if not defined PUCK_PORT set "PUCK_PORT=3000"

rem Add a Windows Firewall rule for trusted Private networks.
set "FIREWALL_RULE=PuckChatLAN-%PUCK_PORT%"
netsh advfirewall firewall show rule name="%FIREWALL_RULE%" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Adding Windows Firewall access for Private networks...
    netsh advfirewall firewall add rule name="%FIREWALL_RULE%" dir=in action=allow protocol=TCP localport=%PUCK_PORT% profile=private >nul 2>&1
    if errorlevel 1 (
        echo [INFO] Administrator approval is required. Windows may show a UAC prompt.
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process -FilePath 'netsh.exe' -Verb RunAs -Wait -PassThru -ArgumentList 'advfirewall firewall add rule name=%FIREWALL_RULE% dir=in action=allow protocol=TCP localport=%PUCK_PORT% profile=private'; if($p){exit $p.ExitCode}else{exit 1}" >nul 2>&1
    )
    if errorlevel 1 (
        echo [WARN] Firewall rule was not added. LAN access may be blocked by Windows Firewall.
        echo Run PowerShell as Administrator and execute:
        echo netsh advfirewall firewall add rule name=%FIREWALL_RULE% dir=in action=allow protocol=TCP localport=%PUCK_PORT% profile=private
    ) else (
        echo [OK] Windows Firewall rule is enabled for Private networks.
    )
) else (
    echo [OK] Windows Firewall rule already exists.
)

set "LAN_IP="
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /R /C:"IPv4.*"') do if not defined LAN_IP set "LAN_IP=%%A"
set "LAN_IP=%LAN_IP: =%"
if "%LAN_IP:~0,4%"=="127." set "LAN_IP="
if "%LAN_IP:~0,8%"=="169.254." set "LAN_IP="

echo.
echo [OK] Node.js:
node -v
echo.
echo ==========================================
echo Puck Chat is starting
echo ==========================================
echo [LOCAL] This PC: http://127.0.0.1:%PUCK_PORT%
if defined LAN_IP (
    echo [LAN]   Other devices: http://%LAN_IP%:%PUCK_PORT%
) else (
    echo [LAN]   Could not detect a LAN IPv4 address. Check ipconfig.
)
echo.
echo [INFO] Other devices must be connected to the same Wi-Fi/router.
echo [INFO] If Windows asks about network access, allow Private networks.
echo [INFO] Keep this window open. Press Ctrl+C to stop the server.
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
