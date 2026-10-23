@echo off
setlocal
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges, please click "Yes" in the UAC prompt...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
echo Cleaning GitHub entries from the hosts file (Steam++ leftovers)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0undo-github-hosts.ps1"
echo.
pause
