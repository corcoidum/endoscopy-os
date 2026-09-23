# scripts/*.sh가 함께 쓰는 설정. 직접 실행하지 않고 source로 불러온다.
# macOS·Linux는 backend/.venv/bin, Windows Git Bash는 backend/.venv/Scripts를 쓴다.

ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
POSTGRES_IMAGE="postgres:16.14-alpine"

if [ -x "$BACKEND/.venv/bin/python" ]; then
  VENV_BIN="$BACKEND/.venv/bin"
  EXE=""
elif [ -x "$BACKEND/.venv/Scripts/python.exe" ]; then
  VENV_BIN="$BACKEND/.venv/Scripts"
  EXE=".exe"
else
  VENV_BIN=""
  EXE=""
fi
PYTHON="$VENV_BIN/python$EXE"
# Windows 한국어 로캘에서도 하위 Process 출력을 UTF-8로 주고받는다.
export PYTHONIOENCODING=utf-8

fail() {
  echo "$*" >&2
  exit 1
}

require_backend_venv() {
  [ -n "$VENV_BIN" ] || fail "backend/.venv가 없습니다. docs/14-macos-development-guide.md의 최초 설치 절차를 먼저 실행해 주세요."
  [ -x "$VENV_BIN/ruff$EXE" ] || fail "ruff가 없습니다. backend/.venv에 requirements-dev.txt를 설치해 주세요."
}

require_frontend_modules() {
  [ -d "$FRONTEND/node_modules" ] || fail "frontend/node_modules가 없습니다. frontend에서 npm ci를 먼저 실행해 주세요."
}

require_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker가 필요합니다. Docker Desktop을 설치·실행한 뒤 다시 시도해 주세요."
  docker info >/dev/null 2>&1 || fail "Docker Engine이 응답하지 않습니다. Docker Desktop을 실행해 주세요."
}

# 컨테이너 안의 PostgreSQL이 TCP로 접속을 받을 때까지 기다린다.
# (초기화 중 임시 서버는 Unix Socket만 열므로 TCP로 확인해야 재시작 틈에 접속하지 않는다.)
wait_for_postgres() {
  local container="$1" database="$2" attempt
  for attempt in $(seq 1 60); do
    if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -d "$database" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  fail "PostgreSQL($container)이 60초 안에 준비되지 않았습니다."
}

wait_for_http() {
  local url="$1" name="$2" attempt
  for attempt in $(seq 1 60); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  fail "$name($url)이 60초 안에 응답하지 않았습니다."
}
