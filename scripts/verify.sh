#!/usr/bin/env bash
# 전체 자동화 검증(macOS·Linux·Windows Git Bash). scripts/verify.ps1과 같은 순서로 검사한다.
# Docker가 필요 없는 검사만 한다. PostgreSQL 전용 Test는 scripts/pg-test.sh, Browser Test는
# scripts/e2e.sh로 따로 실행한다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/_common.sh
. "$ROOT/scripts/_common.sh"
trap 'echo "검증이 실패했습니다: $BASH_COMMAND" >&2' ERR

require_backend_venv
require_frontend_modules

echo "[1/2] Backend lint, type check, test와 dependency를 확인합니다."
cd "$ROOT/backend"
"$VENV_BIN/ruff$EXE" check app tests
"$VENV_BIN/mypy$EXE"
"$VENV_BIN/pytest$EXE" -q
"$VENV_BIN/python$EXE" -m pip check

echo "[2/2] Frontend lint, typecheck, test, build를 실행합니다."
cd "$ROOT/frontend"
npm run lint
npm run typecheck
npm test
npm run build
if [ ! -f dist/client/index.html ]; then
  echo "Frontend build 결과물(dist/client/index.html)이 없습니다." >&2
  exit 1
fi

echo "전체 자동화 검증이 통과했습니다."
