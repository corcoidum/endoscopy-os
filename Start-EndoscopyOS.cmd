@echo off
setlocal
where pwsh.exe >nul 2>nul
if errorlevel 1 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-endoscopy-os.ps1" %*
) else (
    pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-endoscopy-os.ps1" %*
)
if errorlevel 1 (
    pause
)
endlocal
