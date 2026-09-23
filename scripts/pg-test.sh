#!/usr/bin/env bash
# PostgreSQL 전용 통합 Test(macOS·Linux·Windows Git Bash).
# 이 Test는 대상 Database의 public·iam Schema를 지우고 다시 만든다. 그래서 이 Script가 만든
# 일회용 Container에만 연결하고, 끝나면 Container를 지운다. 다른 Database를 지정할 수 없다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/_common.sh
. "$ROOT/scripts/_common.sh"

DB_PORT="${PG_TEST_PORT:-55434}"
CONTAINER="endoscopy-os-pgtest-$$"
DB_PASSWORD="SyntheticPgTestOnly0123456789"

require_docker
require_backend_venv

cleanup() {
  docker stop "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[1/2] 일회용 PostgreSQL Container($CONTAINER)를 시작합니다."
docker run -d --rm --name "$CONTAINER" \
  -e "POSTGRES_PASSWORD=$DB_PASSWORD" -e "POSTGRES_DB=clinic_pgtest" \
  -p "127.0.0.1:$DB_PORT:5432" "$POSTGRES_IMAGE" >/dev/null
wait_for_postgres "$CONTAINER" clinic_pgtest

echo "[2/2] PostgreSQL 전용 Test를 실행합니다."
cd "$BACKEND"
TEST_POSTGRES_URL="postgresql+psycopg://postgres:$DB_PASSWORD@127.0.0.1:$DB_PORT/clinic_pgtest" \
  "$VENV_BIN/pytest$EXE" -q tests/test_postgres_integration.py "$@"

echo "PostgreSQL 전용 Test가 통과했습니다. 일회용 Container는 지웁니다."
