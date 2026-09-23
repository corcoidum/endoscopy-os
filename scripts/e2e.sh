#!/usr/bin/env bash
# 실제 PostgreSQL·Backend·Browser로 주요 흐름을 확인하는 Smoke Test(macOS·Linux·Windows Git Bash).
# scripts/e2e.ps1과 같은 순서다. 매번 일회용 Database Container를 새로 만들고 끝나면 지운다.
# 합성 계정·환자만 쓰며, Browser는 설치된 Google Chrome(E2E_BROWSER_CHANNEL로 변경)을 쓴다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/_common.sh
. "$ROOT/scripts/_common.sh"

# 다른 개발 서버와 겹치지 않는 Port. 필요하면 환경변수로 바꿔 실행한다.
DB_PORT="${E2E_DB_PORT:-55433}"
API_PORT="${E2E_API_PORT:-18000}"
FRONTEND_PORT="${E2E_FRONTEND_PORT:-5174}"
CONTAINER="endoscopy-os-e2e-$$"
DB_PASSWORD="SyntheticE2eOnly0123456789"

require_docker
require_backend_venv
[ -d "$FRONTEND/node_modules/@playwright/test" ] ||
  fail "frontend/node_modules에 @playwright/test가 없습니다. frontend에서 npm ci를 먼저 실행해 주세요."

export APP_ENV="development"
export DATABASE_URL="postgresql+psycopg://postgres:$DB_PASSWORD@127.0.0.1:$DB_PORT/clinic_e2e"
export SESSION_SECRET="synthetic-e2e-session-secret-0123456789abcdef"
export FIELD_ENCRYPTION_KEY="synthetic-e2e-field-key-0123456789abcdefgh"
export SESSION_COOKIE_NAME="clinic_session_e2e"
export SESSION_COOKIE_SECURE="false"
export ALLOWED_ORIGINS="http://127.0.0.1:$FRONTEND_PORT"
export ALLOWED_HOSTS="127.0.0.1,localhost"
export E2E_API_URL="http://127.0.0.1:$API_PORT"
export E2E_FRONTEND_PORT="$FRONTEND_PORT"
export E2E_ADMIN_ID="e2e.admin"
export E2E_ADMIN_INITIAL_PASSWORD="Synthetic-E2E-Initial-42!"
export E2E_ADMIN_PASSWORD="Synthetic-E2E-Changed-42!"

BACKEND_PID=""
cleanup() {
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  docker stop "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[1/4] 일회용 PostgreSQL Container($CONTAINER)를 시작합니다."
docker run -d --rm --name "$CONTAINER" \
  -e "POSTGRES_PASSWORD=$DB_PASSWORD" -e "POSTGRES_DB=clinic_e2e" \
  -p "127.0.0.1:$DB_PORT:5432" "$POSTGRES_IMAGE" >/dev/null
wait_for_postgres "$CONTAINER" clinic_e2e

echo "[2/4] Migration과 합성 관리자 Seed를 적용합니다."
(cd "$ROOT" && "$PYTHON" -m alembic upgrade head)
(
  cd "$BACKEND"
  BOOTSTRAP_ADMIN_LOGIN_ID="$E2E_ADMIN_ID" \
    BOOTSTRAP_ADMIN_DISPLAY_NAME="E2E 합성 관리자" \
    BOOTSTRAP_ADMIN_PASSWORD="$E2E_ADMIN_INITIAL_PASSWORD" \
    "$PYTHON" -m app.cli.seed_identity
)

echo "[3/4] Backend를 http://127.0.0.1:$API_PORT 에서 시작합니다."
(cd "$BACKEND" && exec "$VENV_BIN/uvicorn$EXE" app.main:app \
  --host 127.0.0.1 --port "$API_PORT" --log-level warning) &
BACKEND_PID=$!
wait_for_http "http://127.0.0.1:$API_PORT/health/ready" "Backend"

echo "[4/4] Browser Smoke Test를 실행합니다."
(cd "$FRONTEND" && npm run e2e)

echo "Browser Smoke Test가 통과했습니다."
