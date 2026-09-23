#!/usr/bin/env bash
# 합성 데이터로 로컬 미리보기를 띄운다(macOS·Linux·Windows Git Bash).
#
#   scripts/dev.sh           개발 DB를 준비하고 Backend·Frontend를 띄운다(Ctrl+C로 끝냄)
#   scripts/dev.sh --reset   개발 DB를 지우고 새로 만든 뒤 띄운다
#   scripts/dev.sh --smoke   모두 띄워 응답을 확인한 뒤 바로 정리한다(Script 점검용)
#
# PostgreSQL 데이터는 Docker Volume(endoscopy-os-dev-pgdata)에 남아 다시 실행해도 이어진다.
# 운영 설정(.env)과 실제 환자정보를 쓰지 않는다. Seed는 합성 관리자·환자·예약만 만든다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/_common.sh
. "$ROOT/scripts/_common.sh"

DB_PORT="${DEV_DB_PORT:-55440}"
API_PORT="${DEV_API_PORT:-18002}"
WEB_PORT="${DEV_WEB_PORT:-5176}"
CONTAINER="endoscopy-os-dev-db"
VOLUME="endoscopy-os-dev-pgdata"
DB_PASSWORD="SyntheticDevOnly0123456789"
ADMIN_ID="dev.admin"
ADMIN_NAME="합성 개발 관리자"
ADMIN_INITIAL_PASSWORD="Synthetic-Dev-Initial-42!"

RESET=0
SMOKE=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --smoke) SMOKE=1 ;;
    *) fail "알 수 없는 옵션입니다: $arg (사용 가능: --reset, --smoke)" ;;
  esac
done

require_docker
require_backend_venv
require_frontend_modules

export APP_ENV="development"
export DATABASE_URL="postgresql+psycopg://postgres:$DB_PASSWORD@127.0.0.1:$DB_PORT/clinic_dev"
export SESSION_SECRET="synthetic-dev-session-secret-0123456789abcdef"
# 다시 실행해도 암호화한 합성 데이터를 읽을 수 있도록 고정한 개발 전용 Key다.
export FIELD_ENCRYPTION_KEY="synthetic-dev-field-key-0123456789abcdefghij"
export SESSION_COOKIE_NAME="clinic_session_dev"
export SESSION_COOKIE_SECURE="false"
export ALLOWED_ORIGINS="http://127.0.0.1:$WEB_PORT"
export ALLOWED_HOSTS="127.0.0.1,localhost"

API_PID=""
WEB_PID=""
cleanup() {
  for pid in "$WEB_PID" "$API_PID"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  # 데이터는 Volume에 남기고 Container만 멈춘다.
  docker stop "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if [ "$RESET" = 1 ]; then
  echo "개발 Database를 지우고 새로 만듭니다."
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
fi

echo "[1/4] 개발 PostgreSQL Container($CONTAINER)를 준비합니다."
if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  docker start "$CONTAINER" >/dev/null
else
  docker run -d --name "$CONTAINER" \
    -e "POSTGRES_PASSWORD=$DB_PASSWORD" -e "POSTGRES_DB=clinic_dev" \
    -p "127.0.0.1:$DB_PORT:5432" -v "$VOLUME:/var/lib/postgresql/data" \
    "$POSTGRES_IMAGE" >/dev/null
fi
wait_for_postgres "$CONTAINER" clinic_dev

echo "[2/4] Migration과 합성 Seed(관리자·환자·다음 2주 예약)를 적용합니다."
(cd "$ROOT" && "$PYTHON" -m alembic upgrade head)
(
  cd "$BACKEND"
  BOOTSTRAP_ADMIN_LOGIN_ID="$ADMIN_ID" \
    BOOTSTRAP_ADMIN_DISPLAY_NAME="$ADMIN_NAME" \
    BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_INITIAL_PASSWORD" \
    "$PYTHON" -m app.cli.seed_identity
  "$PYTHON" -m app.cli.seed_patients
  # 서울 기준 내일부터 2주. 이미 있는 예약은 다시 만들지 않는다.
  SEED_RANGE="$("$PYTHON" -c "from datetime import timedelta
from app.core.clock import today_in_seoul
today = today_in_seoul()
print(today + timedelta(days=1), today + timedelta(days=14))")"
  "$PYTHON" -m app.cli.seed_appointments \
    --start-date "${SEED_RANGE%% *}" --end-date "${SEED_RANGE##* }"
)

echo "[3/4] Backend를 http://127.0.0.1:$API_PORT 에서 시작합니다."
(cd "$BACKEND" && exec "$VENV_BIN/uvicorn$EXE" app.main:app \
  --host 127.0.0.1 --port "$API_PORT" --log-level warning) &
API_PID=$!
wait_for_http "http://127.0.0.1:$API_PORT/health/ready" "Backend"

echo "[4/4] Frontend를 http://127.0.0.1:$WEB_PORT 에서 시작합니다."
(cd "$FRONTEND" && VITE_API_PROXY_TARGET="http://127.0.0.1:$API_PORT" exec node \
  node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$WEB_PORT" --strictPort --clearScreen false) &
WEB_PID=$!
wait_for_http "http://127.0.0.1:$WEB_PORT/" "Frontend"

cat <<EOF

합성 데이터 미리보기가 준비됐습니다.
  주소        http://127.0.0.1:$WEB_PORT
  관리자 ID   $ADMIN_ID
  최초 Password  $ADMIN_INITIAL_PASSWORD
              처음 한 번 로그인하면 새 Password로 바꿔야 하고, 바꾼 Password는 다음 실행에도 유지됩니다.
  복용약 의사 결정을 시험하려면 관리자 화면 → 의사 Profile에서 합성 의사를 한 명 등록하세요.
  끝내려면 Ctrl+C. 데이터는 Docker Volume($VOLUME)에 남습니다(--reset으로 초기화).

EOF

if [ "$SMOKE" = 1 ]; then
  echo "점검 모드라 바로 정리합니다."
  exit 0
fi
wait "$API_PID" "$WEB_PID"
