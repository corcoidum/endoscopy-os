[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

function Get-ConfigurationFile {
    $productionConfiguration = Join-Path $projectRoot ".env"
    $previewConfiguration = Join-Path $projectRoot ".env.sprint2-preview"

    if (Test-Path $productionConfiguration) {
        return $productionConfiguration
    }
    if (Test-Path $previewConfiguration) {
        Write-Warning ".env가 없어 합성 데이터 Preview 설정을 사용합니다. 실제 환자정보를 입력하지 마세요."
        return $previewConfiguration
    }
    throw ".env 또는 .env.sprint2-preview가 없습니다. README의 최초 환경설정 절차를 확인해 주세요."
}

function Get-ConfigurationValue {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Name,
        [string]$DefaultValue = ""
    )

    $line = Get-Content -LiteralPath $Path | Where-Object {
        $_ -match "^$([Regex]::Escape($Name))="
    } | Select-Object -Last 1
    if (-not $line) {
        return $DefaultValue
    }
    return ($line -split "=", 2)[1].Trim().Trim('"')
}

function Test-DockerEngine {
    & docker info *> $null
    return $LASTEXITCODE -eq 0
}

function Start-DockerDesktopIfNeeded {
    if (Test-DockerEngine) {
        return
    }

    $dockerDesktopCandidates = @(
        (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
        (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe")
    )
    $dockerDesktopPath = $dockerDesktopCandidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    if (-not $dockerDesktopPath) {
        throw "Docker Engine이 꺼져 있고 Docker Desktop 실행 파일을 찾지 못했습니다."
    }

    Write-Host "Docker Desktop을 시작합니다. 잠시 기다려 주세요."
    Start-Process -FilePath $dockerDesktopPath -WindowStyle Hidden

    $deadline = (Get-Date).AddMinutes(2)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
        if (Test-DockerEngine) {
            return
        }
    }
    throw "2분 안에 Docker Engine이 준비되지 않았습니다. Docker Desktop 상태를 확인해 주세요."
}

function Get-ApplicationUrl {
    param([Parameter(Mandatory)] [string]$ConfigurationFile)

    $siteAddress = Get-ConfigurationValue -Path $ConfigurationFile -Name "CLINIC_SITE_ADDRESS" -DefaultValue "https://localhost"
    $httpsPort = Get-ConfigurationValue -Path $ConfigurationFile -Name "CLINIC_HTTPS_PORT" -DefaultValue "443"
    if ($httpsPort -eq "443" -or $siteAddress -match ":\d+$") {
        return $siteAddress.TrimEnd("/")
    }
    return "$($siteAddress.TrimEnd('/')):$httpsPort"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker 명령을 찾지 못했습니다. Docker Desktop을 먼저 설치해 주세요."
}

$configurationFile = Get-ConfigurationFile
$applicationUrl = Get-ApplicationUrl -ConfigurationFile $configurationFile

Start-DockerDesktopIfNeeded
Push-Location $projectRoot
try {
    Write-Host "내시경 운영 시스템을 시작합니다."
    $composeArguments = @(
        "compose",
        "--env-file", $configurationFile,
        "up", "-d"
    )
    if (-not $SkipBuild) {
        $composeArguments += "--build"
    }
    & docker @composeArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose 기동에 실패했습니다."
    }

    Write-Host "Application 준비 상태를 확인합니다."
    $deadline = (Get-Date).AddMinutes(2)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $statusCode = & curl.exe --insecure --silent --output NUL --write-out "%{http_code}" --max-time 5 $applicationUrl
            if ($LASTEXITCODE -eq 0 -and $statusCode -eq "200") {
                $ready = $true
                break
            }
        }
        catch {
            # curl.exe 자체를 실행하지 못한 경우에도 아래 대기 후 다시 시도한다.
        }
        # 아직 준비되지 않았을 때 curl.exe가 예외 없이 실패 상태코드만 돌려주므로,
        # 재시도 간격은 try/catch 밖에서 항상 적용해야 CPU를 점유하지 않는다.
        Start-Sleep -Seconds 3
    }
    if (-not $ready) {
        & docker compose --env-file $configurationFile ps
        throw "Application이 2분 안에 준비되지 않았습니다. 위 Container 상태를 확인해 주세요."
    }

    Write-Host "준비 완료: $applicationUrl"
    if (-not $NoBrowser) {
        Start-Process $applicationUrl
    }
}
finally {
    Pop-Location
}
