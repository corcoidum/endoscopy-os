[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$productionConfiguration = Join-Path $projectRoot ".env"
$previewConfiguration = Join-Path $projectRoot ".env.sprint2-preview"

if (Test-Path $productionConfiguration) {
    $configurationFile = $productionConfiguration
}
elseif (Test-Path $previewConfiguration) {
    $configurationFile = $previewConfiguration
}
else {
    throw ".env 또는 .env.sprint2-preview가 없습니다."
}

Push-Location $projectRoot
try {
    & docker compose --env-file $configurationFile stop
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose 중지에 실패했습니다."
    }
    Write-Host "내시경 운영 시스템을 안전하게 중지했습니다. Database Volume은 유지됩니다."
}
finally {
    Pop-Location
}
