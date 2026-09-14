[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $PSScriptRoot "start-endoscopy-os.ps1"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$desktopCandidates = @($desktopPath)
if ($env:OneDrive) {
    $desktopCandidates += Join-Path $env:OneDrive "Desktop"
}
if ($env:USERPROFILE) {
    $desktopCandidates += Join-Path $env:USERPROFILE "Desktop"
}
$desktopCandidates = $desktopCandidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
    Select-Object -Unique
$desktopPath = $desktopCandidates | Select-Object -First 1
if (-not $desktopPath) {
    throw "바탕화면 폴더를 찾을 수 없습니다."
}
$shortcutPath = Join-Path $desktopPath "내시경 운영 시스템.lnk"

if (-not (Test-Path -LiteralPath $launcherPath)) {
    throw "실행 파일을 찾을 수 없습니다: $launcherPath"
}

$powerShellCommand = Get-Command pwsh.exe -ErrorAction SilentlyContinue
if (-not $powerShellCommand) {
    $powerShellCommand = Get-Command powershell.exe -ErrorAction SilentlyContinue
}
if (-not $powerShellCommand) {
    throw "PowerShell 실행 파일을 찾을 수 없습니다."
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powerShellCommand.Source
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = "내시경 운영 시스템 시작"
$shortcut.Save()

Write-Host "바탕화면 바로가기를 만들었습니다: $shortcutPath"
