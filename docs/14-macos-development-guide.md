# macOS(맥북)에서 이어서 작업하기

- 작성일: 2026-09-23
- 대상: Windows 개발 PC에서 하던 작업을 맥북에서 이어서 할 때
- 원칙: 합성 환자·합성 직원 계정만 쓴다. 실제 환자정보, 운영 비밀값(`.env`), 운영 Database는
  맥북에 가져오지 않는다.

## 1. 지금 상태 (2026-09-23 기준)

| 구분 | 상태 |
|---|---|
| 구현 완료 | Sprint 1~3B, Sprint 4A 인적사항 1·2차 확인, Sprint 4B 대장내시경 복용약 확인·의사 결정 |
| 최근 보고서 | [12 Sprint 3B 종료·4A](./12-sprint-4a-identity-verification-report.md), [13 Sprint 4B](./13-sprint-4b-medication-review-report.md) |
| 최근 QA | [2026-09-22 이중확인](./qa/2026-09-22-identity-verification.md), [2026-09-23 복용약](./qa/2026-09-23-medication-review.md) |
| 자동 검사 | Backend Test 115개 + PostgreSQL 전용 12개, Frontend Test 47개, Browser E2E 4개 모두 통과 |
| Migration 최신 | `20260923_0009` (복용약 확인·의사 결정) |

Windows 개발 PC에서 확인한 도구 버전은 Python 3.13, Node.js 24, PostgreSQL 16.14(Docker)다.

## 2. 맥북 처음 한 번 준비

### 설치할 것

- [Homebrew](https://brew.sh)
- Python 3.13, Node.js 24, Git
- Docker Desktop for Mac(Apple Silicon·Intel 모두 가능). 설치 뒤 한 번 실행해 둔다.
- Google Chrome. Browser E2E가 설치된 Chrome을 쓴다.

```bash
brew install python@3.13 node@24 git
```

`node@24`는 Homebrew가 기본 PATH에 올리지 않으므로 한 번 등록한다.

```bash
echo "export PATH=\"$(brew --prefix node@24)/bin:\$PATH\"" >> ~/.zshrc
```

새 터미널을 열고 버전을 확인한다.

```bash
python3.13 --version
```

```bash
node --version
```

### 저장소 받기와 개발 환경 만들기

비공개 저장소라면 먼저 GitHub 로그인(`gh auth login` 또는 Git 자격 증명)이 필요하다.

```bash
git clone https://github.com/corcoidum/endoscopy-os.git
```

```bash
cd endoscopy-os
```

```bash
python3.13 -m venv backend/.venv
```

```bash
backend/.venv/bin/python -m pip install -r backend/requirements-dev.txt
```

```bash
cd frontend && npm ci && cd ..
```

설치가 끝나면 전체 검증이 통과하는지 확인한다.

```bash
scripts/verify.sh
```

`package-lock.json`에는 Apple Silicon용 esbuild·Rollup·oxlint·TypeScript 바이너리 항목이 들어
있어 `npm ci`로 그대로 설치된다.

## 3. 자주 쓰는 명령

맥북에서는 `scripts/*.sh`를 쓴다. 같은 Script가 Windows Git Bash에서도 돈다.

| 목적 | macOS | Windows |
|---|---|---|
| 전체 자동 검증(Docker 불필요) | `scripts/verify.sh` | `scripts\verify.ps1` 또는 Git Bash에서 `scripts/verify.sh` |
| PostgreSQL 전용 Test | `scripts/pg-test.sh` | Git Bash에서 `scripts/pg-test.sh` |
| Browser E2E | `scripts/e2e.sh` | `scripts\e2e.ps1` 또는 Git Bash에서 `scripts/e2e.sh` |
| 합성 데이터 미리보기 | `scripts/dev.sh` | Git Bash에서 `scripts/dev.sh` |
| Docker Compose 전체 구성 | `docker compose up -d --build`(`.env` 필요) | `Start-EndoscopyOS.cmd` |

### PostgreSQL 전용 Test

이 Test는 대상 Database의 Schema를 지우고 다시 만든다. `scripts/pg-test.sh`는 매번 일회용
Container를 만들어 거기에만 연결하고 끝나면 지운다. 다른 Database를 지정하지 않는다.

```bash
scripts/pg-test.sh
```

### Browser E2E

Docker Desktop이 켜져 있어야 한다. 일회용 PostgreSQL, 합성 관리자, 실제 Backend, Vite를 띄워
예약 변경·일정 예외·이중확인·복용약 흐름을 확인하고 모두 정리한다. Port는 55433·18000·5174다.

```bash
scripts/e2e.sh
```

Chrome 대신 다른 Playwright Browser Channel을 쓰려면 `E2E_BROWSER_CHANNEL`을 지정한다.

### 합성 데이터 미리보기

```bash
scripts/dev.sh
```

- 주소: http://127.0.0.1:5176 (Backend 18002, PostgreSQL 55440)
- 관리자 ID `dev.admin`, 최초 Password `Synthetic-Dev-Initial-42!`. 처음 로그인하면 새 Password로
  바꿔야 하고, 바꾼 Password는 다음 실행에도 유지된다.
- 합성 환자 4명과 내일부터 2주 동안의 합성 예약을 만든다. 다시 실행해도 중복으로 만들지 않는다.
- 복용약 의사 결정을 시험하려면 관리자 화면 → 의사 Profile에서 합성 의사를 한 명 등록한다.
- Ctrl+C로 끝내면 서버와 DB Container를 멈춘다. 데이터는 Docker Volume `endoscopy-os-dev-pgdata`에
  남는다. 처음 상태로 돌리려면 `scripts/dev.sh --reset`.
- Port를 바꾸려면 `DEV_DB_PORT`·`DEV_API_PORT`·`DEV_WEB_PORT`를 지정한다.

## 4. Windows와 다른 점

- `.ps1`과 Root의 `.cmd` 파일은 Windows 전용이다. 맥북에서는 3장의 `.sh`를 쓴다.
- README의 개별 명령은 Windows 경로(`backend\.venv\Scripts\...`) 기준이다. 맥북에서는
  `backend/.venv/bin/...`으로 바꿔 쓴다. 예: `backend/.venv/bin/pytest -q`.
- `.env`와 `.env.sprint2-preview`는 비밀값이라 Git에 없다. 맥북에서 Docker Compose 전체 구성을
  띄우려면 `.env.example`로 새 `.env`를 만들고 새 난수를 넣는다. 운영 비밀값을 옮기지 않는다.
  화면 확인은 `.env`가 필요 없는 `scripts/dev.sh`로 충분하다.
- 줄바꿈은 `.gitattributes`가 정한다(`.sh`는 LF, `.ps1`은 CRLF). Windows는 `core.autocrlf=true`라
  작업 폴더에 CRLF로 보이지만 저장소에는 LF로 들어간다. 따로 손댈 필요 없다.
- Windows 한국어 로캘(cp949)에서 필요했던 UTF-8 처리는 Script에 들어 있어 맥북에서도 그대로 동작한다.

## 5. 두 PC를 오가며 작업하기

1. 작업 시작 전에 받는다: `git pull`
2. 작업하고 `scripts/verify.sh`로 확인한다. 상태를 바꾸는 화면 흐름은 `scripts/e2e.sh`도 돌린다.
3. 커밋하고 올린다: `git push`
4. 다른 PC로 돌아가면 다시 `git pull`

Claude Code 같은 도구로 이어서 작업할 때는 새 세션이 이전 대화를 모른다. Root의 `AGENTS.md`,
이 문서, 최근 Sprint 보고서를 먼저 읽게 하면 같은 규칙으로 이어서 작업한다.

## 6. 다음 작업 후보

1. 아래 결정 대기 항목을 정한다.
2. 준비 완료 Gate와 장정결제 확인: 유효한 이중확인과 복용약 확인(`medication_state`) 없이 준비
   완료를 막는다(PRD PRO-002, VER-004).
3. 예약 등록 2단계 달력의 날짜별 `가능 N`이 지금 화면이 불러온 예약만으로 계산되는 문제를
   고친다(Sprint 3B부터 있던 문제, Backend가 저장 시 다시 검사하므로 중복 예약은 없음).
4. PACS 수기확인: DEC-31(검사 시작 필수 여부)이 정해진 뒤 진행한다.
5. 약제 Master(MED-001): 참고 중단기간은 원내 의사가 출처와 함께 입력해야 한다.

## 7. 결정 대기 항목

| 항목 | 지금 동작 | 확인할 것 |
|---|---|---|
| 인적사항 확인 방법 | 대면 문답·신분증 대조·전화 확인·차트/검진기록 대조 4가지(DB 제약) | 원내 방법 목록 |
| 1·2차 권한 배분 | 원무 1차, 내시경 담당 2차, 관리자 둘 다 | 원무가 2차도 하는지 |
| PRD VER-002 문구 | 화면을 연 뒤 정보가 바뀌면 `VERIFICATION_STALE`, 같은 계정의 2차만 `SECOND_REVIEWER_INVALID` | PRD 문구를 구현에 맞출지 |
| 복용 분류와 의사 검토 | 분류는 기록만 한다. 중단 검토 약으로 올린 약만 의사 확인 대상이다 | 항응고제·항혈소판제 등 특정 분류를 자동으로 의사 검토 대상으로 볼지 |
| 중단 일수 범위 | 1~90일 | 원내 상한 |
| 중단 시작일 계산 | 날짜로 계산하지 않고 일수와 결정 당시 검사일만 남긴다 | "검사 N일 전"의 당일 포함 기준 |
| 의사 결정 입력(DEC-32) | 입력자와 결정 의사를 함께 기록, 활성 의사 Profile 한 명 자동 사용 | 원장 직접 입력인지 직원 대리 입력인지 |
| 그 밖의 미확정 Decision | DEC-02·09·10·15·31 등 | [PRD 9.3](./02-product-requirements-document.md) |
