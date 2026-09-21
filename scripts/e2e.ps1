[CmdletBinding()]
param(
    # 다른 개발 서버와 겹치지 않는 Port를 쓴다. 필요하면 바꿔 실행한다.
    [int]$DatabasePort = 55433,
    [int]$ApiPort = 18000,
    [int]$FrontendPort = 5174
)

# 실제 PostgreSQL·Backend·Browser로 예약 변경 흐름을 확인하는 Smoke Test.
# 매번 일회용 Database Container를 새로 만들고 끝나면 지운다. 합성 계정·환자만 쓴다.
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"
$python = Join-Path $backendDir ".venv\Scripts\python.exe"
$uvicorn = Join-Path $backendDir ".venv\Scripts\uvicorn.exe"
$container = "endoscopy-os-e2e-$PID"
$dbPassword = "SyntheticE2eOnly0123456789"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker가 필요합니다. Docker Desktop을 실행한 뒤 다시 시도해 주세요."
}
if (-not (Test-Path $uvicorn)) {
    throw "backend\.venv가 없습니다. README의 최초 설치 절차를 먼저 실행해 주세요."
}
if (-not (Test-Path (Join-Path $frontendDir "node_modules\@playwright\test"))) {
    throw "frontend\node_modules에 @playwright/test가 없습니다. npm ci를 먼저 실행해 주세요."
}

# 이 Script가 바꾼 환경변수는 끝나면 원래대로 돌려놓는다.
$e2eEnv = @{
    APP_ENV                    = "development"
    DATABASE_URL               = "postgresql+psycopg://postgres:$dbPassword@127.0.0.1:$DatabasePort/clinic_e2e"
    SESSION_SECRET             = "synthetic-e2e-session-secret-0123456789abcdef"
    FIELD_ENCRYPTION_KEY       = "synthetic-e2e-field-key-0123456789abcdefgh"
    SESSION_COOKIE_NAME        = "clinic_session_e2e"
    SESSION_COOKIE_SECURE      = "false"
    ALLOWED_ORIGINS            = "http://127.0.0.1:$FrontendPort"
    ALLOWED_HOSTS              = "127.0.0.1,localhost"
    E2E_API_URL                = "http://127.0.0.1:$ApiPort"
    E2E_FRONTEND_PORT          = "$FrontendPort"
    E2E_ADMIN_ID               = "e2e.admin"
    E2E_ADMIN_INITIAL_PASSWORD = "Synthetic-E2E-Initial-42!"
    E2E_ADMIN_PASSWORD         = "Synthetic-E2E-Changed-42!"
}
$previousEnv = @{}
foreach ($name in $e2eEnv.Keys) {
    $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, $e2eEnv[$name], "Process")
}

$backend = $null
try {
    Write-Host "[1/4] 일회용 PostgreSQL Container($container)를 시작합니다."
    & docker run -d --rm --name $container `
        -e "POSTGRES_PASSWORD=$dbPassword" -e "POSTGRES_DB=clinic_e2e" `
        -p "127.0.0.1:${DatabasePort}:5432" postgres:16.14-alpine | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL Container를 시작하지 못했습니다." }
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        & docker exec $container pg_isready -U postgres -d clinic_e2e 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "PostgreSQL이 준비되지 않았습니다." }

    Write-Host "[2/4] Migration과 합성 관리자 Seed를 적용합니다."
    Push-Location $projectRoot
    try {
        & $python -m alembic upgrade head
        if ($LASTEXITCODE -ne 0) { throw "Migration이 실패했습니다." }
    }
    finally { Pop-Location }
    Push-Location $backendDir
    try {
        $env:BOOTSTRAP_ADMIN_LOGIN_ID = $e2eEnv.E2E_ADMIN_ID
        $env:BOOTSTRAP_ADMIN_DISPLAY_NAME = "E2E 합성 관리자"
        $env:BOOTSTRAP_ADMIN_PASSWORD = $e2eEnv.E2E_ADMIN_INITIAL_PASSWORD
        & $python -m app.cli.seed_identity
        if ($LASTEXITCODE -ne 0) { throw "합성 관리자 Seed가 실패했습니다." }
    }
    finally {
        Remove-Item Env:BOOTSTRAP_ADMIN_LOGIN_ID, Env:BOOTSTRAP_ADMIN_DISPLAY_NAME, Env:BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
        Pop-Location
    }

    Write-Host "[3/4] Backend를 http://127.0.0.1:$ApiPort 에서 시작합니다."
    $backend = Start-Process -FilePath $uvicorn -WorkingDirectory $backendDir -PassThru -NoNewWindow `
        -ArgumentList @("app.main:app", "--host", "127.0.0.1", "--port", "$ApiPort", "--log-level", "warning")
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/health/ready" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        }
        catch { Start-Sleep -Seconds 1 }
    }
    if (-not $ready) { throw "Backend가 준비되지 않았습니다." }

    Write-Host "[4/4] Browser Smoke Test를 실행합니다."
    Push-Location $frontendDir
    try {
        & npm.cmd run e2e
        if ($LASTEXITCODE -ne 0) { throw "Browser Smoke Test가 실패했습니다." }
    }
    finally { Pop-Location }

    Write-Host "Browser Smoke Test가 통과했습니다."
}
finally {
    if ($backend -and -not $backend.HasExited) {
        Stop-Process -Id $backend.Id -Force -Confirm:$false -ErrorAction SilentlyContinue
    }
    & docker stop $container 2>$null | Out-Null
    foreach ($name in $previousEnv.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnv[$name], "Process")
    }
}
