@echo off
setlocal
where pwsh.exe >nul 2>nul
if errorlevel 1 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-desktop-shortcut.ps1" %*
) else (
    pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-desktop-shortcut.ps1" %*
)
if errorlevel 1 pause
pause
endlocal
