[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "[1/2] Backend test와 dependency를 확인합니다."
Push-Location (Join-Path $projectRoot "backend")
try {
    if (-not (Test-Path ".\.venv\Scripts\pytest.exe")) {
        throw "backend\.venv가 없습니다. README의 최초 설치 절차를 먼저 실행해 주세요."
    }
    & ".\.venv\Scripts\pytest.exe" -q
    if ($LASTEXITCODE -ne 0) { throw "Backend test가 실패했습니다." }

    & ".\.venv\Scripts\pip.exe" check
    if ($LASTEXITCODE -ne 0) { throw "Python dependency 검사가 실패했습니다." }
}
finally {
    Pop-Location
}

Write-Host "[2/2] Frontend typecheck, build, artifact test를 실행합니다."
Push-Location (Join-Path $projectRoot "frontend")
try {
    if (-not (Test-Path ".\node_modules")) {
        throw "frontend\node_modules가 없습니다. npm ci를 먼저 실행해 주세요."
    }
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw "Frontend typecheck가 실패했습니다." }

    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build가 실패했습니다." }

    & npm.cmd run test:sites
    if ($LASTEXITCODE -ne 0) { throw "Frontend artifact test가 실패했습니다." }
}
finally {
    Pop-Location
}

Write-Host "전체 자동화 검증이 통과했습니다."
