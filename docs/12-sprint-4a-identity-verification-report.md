# Sprint 3B 종료 검증 · Sprint 4A 인적사항 1·2차 확인 보고서

- 작업일: 2026-09-22
- 데이터: 합성 환자·합성 직원 계정만 사용
- 범위 밖: Git push, 외부 배포, 운영 Database 변경, 준비·약제·예약금·병리 구현,
  PACS 수기확인
- 관련 QA 기록: [2026-09-22 인적사항 1·2차 확인 QA](./qa/2026-09-22-identity-verification.md)

## 1. Sprint 3B 종료 검증

Sprint 4A를 시작하기 전에 Sprint 3B 결과를 그대로 다시 실행했다.

| 검사 | 결과 |
|---|---|
| `scripts/verify.ps1` | 통과(아래 실행 환경 문제를 고친 뒤) |
| `scripts/e2e.ps1` | Browser Test 2개 통과: 예약 변경·이력·취소, 일정 예외 등록·승인·영향받는 예약·취소 |
| PostgreSQL 전용 Test | 3개 통과. 이번 작업에서 만든 일회용 `postgres:16.14-alpine` Container `endoscopy-os-pgtest-3b`에만 연결했고 끝난 뒤 삭제했다 |

- 제품 회귀는 없었다.
- 실행 환경 문제 1건: PowerShell에서 실행하면 Windows 기본 Code Page(cp949)로
  Alembic 하위 Process의 UTF-8 출력을 읽다가 `UnicodeDecodeError`가 났다. Test
  Harness가 하위 Process 출력을 UTF-8로 읽고 `PYTHONIOENCODING=utf-8`을 넘기도록
  고쳤다(커밋 `9f9ae95`). 제품 코드는 바꾸지 않았다.
- 판정: Sprint 3B를 종료한다.

## 2. Sprint 4A 구현 범위

### Backend

**저장 구조** — Migration `20260922_0008`이 `patient_verifications` Table을 만든다.

- 예약별·단계별(`PRIMARY`, `SECONDARY`) 확인 기록을 행으로 쌓는다. 지우지 않고
  `is_valid`를 내려 무효화하며, 무효화 종류(`CORE_CHANGED`, `CORRECTED`)·사유·처리자·
  시각을 같은 행에 남긴다.
- 확인 당시 Snapshot: 이름·차트번호·생년월일·성별, 검사일·시작시각·검사 구성과
  검사별 수면·세트60/90·일반/검진, 계산된 나이·계산방식(`FULL_AGE`/
  `SCREENING_YEAR_AGE`)·기준일(검사일), 예약 `row_version`, 확인자·시각·방법·메모.
  원본 환자·예약이 바뀌어도 과거 Snapshot은 바뀌지 않는다.
- 부분 Unique Index `uq_patient_verifications_valid_stage`가 예약마다 단계별 유효
  기록을 하나로 제한한다. CHECK 제약은 단계·방법·나이 방식·무효화 종류 값과 음수
  나이를 막고, 무효 행에는 무효화 시각·종류·사유가 반드시 있고 유효 행에는 없게 한다.

**API** — 모두 기존 Session·CSRF·Permission 검사를 그대로 쓴다.

| Method | Endpoint | 권한 | 설명 |
|---|---|---|---|
| `GET` | `/api/appointments/{id}/verifications` | `appointment.read` | 현재 상태, 확인할 핵심정보와 지문, 유효한 1·2차, 전체 이력 |
| `POST` | `/api/appointments/{id}/verifications/primary` | `verification.primary` | 1차 확인(201) |
| `POST` | `/api/appointments/{id}/verifications/secondary` | `verification.secondary` | 2차 확인(201) |
| `POST` | `/api/appointments/{id}/verifications/secondary/correct` | `verification.secondary` | 사유를 받아 완료된 2차 확인을 취소 |

- 예약 목록·상세 응답에 `verification_state`(`UNVERIFIED`, `PRIMARY_DONE`,
  `VERIFIED`, `REVERIFY_REQUIRED`)를 더했다. PRD 상태표의 `PRIMARY_VALID`·
  `SECONDARY_VALID`는 각각 `PRIMARY_DONE`·`VERIFIED`에 해당한다.
- 오류 코드: 낡은 화면 `409 VERIFICATION_STALE`, 같은 단계 중복
  `409 VERIFICATION_ALREADY_DONE`, 1차 없이 2차 `409 PRIMARY_VERIFICATION_REQUIRED`,
  1차 확인자와 같은 계정 `409 SECOND_REVIEWER_INVALID`, 취소·No-show 예약
  `409 APPOINTMENT_NOT_ACTIVE`, 권한 부족 `403 PERMISSION_DENIED`, CSRF 오류
  `403 CSRF_TOKEN_INVALID`, 빈 정정 사유 `422`.

**확인 규칙**

- 2차 확인은 유효한 1차 확인이 있고, 1차 확인자와 다른 활성 로그인 사용자가 1차와
  같은 핵심정보를 볼 때만 저장된다. 관리자도 같은 계정으로는 2차 확인할 수 없다.
  비활성화된 계정은 이미 열린 Session이어도 인증 단계에서 거부된다.
- 화면은 확인할 핵심정보의 SHA-256 지문(`expected_fingerprint`)을 함께 보낸다. 서버의
  현재 값과 다르면 저장하지 않는다.
- 동시 요청: 확인 요청은 환자 → 예약 순으로 행을 잠근 뒤 다시 읽는다. 환자·예약
  핵심정보 변경도 같은 행을 잠그므로 확인과 변경이 한 줄로 선다. 마지막 방어선인
  부분 Unique Index 위반은 `409 VERIFICATION_ALREADY_DONE`으로 바꾼다.

**정정과 자동 무효화**

- 2차 확인 정정은 화면에서 `2차 확인 정정 → 사유 입력 → 완료 상태 취소` 두 단계로
  한다. 원래 2차 기록은 남기고 `CORRECTED`·정정자·사유·시각으로 무효화하며, 유효한
  1차는 유지해 2차만 다시 받는다.
- 환자 이름·차트번호·생년월일·성별이 바뀌면 그 환자의 활성(`BOOKED`) 예약 확인을,
  예약의 검사일·시작시각·검사 종류·수면·세트60/90·일반/검진이 바뀌면 그 예약의
  확인을 `CORE_CHANGED`로 무효화한다. 사유에는 바뀐 항목과 변경 사유를 함께 남긴다.
  예) `예약 핵심정보 변경(시작시각): 환자 요청으로 시간 변경`
- 연락처·특이사항·메모 같은 핵심정보 밖의 변경은 확인을 유지한다.
- 무효화는 원본 변경과 같은 Transaction에서 일어난다. 변경이 실패하면 원본과 확인
  기록이 모두 그대로다.
- 취소·No-show 예약에는 새 확인을 받지 않는다. 지난 확인 기록은 그대로 남는다.

**권한** — `verification.primary`(인적사항 1차 확인)를 새로 만들어 관리자·원무 역할에
부여했다. 기존 Database는 Migration이 두 역할에 같은 권한을 더한다. 2차는 기존
`verification.secondary`(관리자·내시경 담당)를 쓴다.

**업무 이력과 영구 Audit의 구분** — 확인·정정·무효화 기록은 업무 이력이다.
사용자·권한 변경을 포함한 변경 불가 영구 Audit Log는 Sprint 7 범위로 남겨 둔다.

### Frontend

- 예약 상세 `업무 요약`: 인적사항 이중확인 Panel. 확인할 핵심정보(나이는 계산방식·
  성별·기준일과 함께), 유효한 1·2차의 확인자·시각·방법·메모, 재확인 사유, 확인 방법
  선택과 메모, 1차·2차 버튼, 2차 정정 두 단계, 확인 이력(확인 당시 Snapshot과 무효화
  정보)을 보여 준다.
- `확인 업무` 화면: 오늘부터 14일 동안의 실제 예약 중 이중확인이 끝나지 않은 예약을
  재확인 필요 → 1차 확인 대기 → 2차 확인 대기 순으로 보여 준다.
- 주간 보드 왼쪽 `오늘 우선 처리`: 합성 Fixture 대신 같은 실제 이중확인 대기의 건수와
  첫 처리 대상을 보여 준다.
- 주간 카드와 일간 보드는 실제 예약의 이중확인 상태만 표시한다. 약제·D-1·예약금
  표시와 PACS는 실제 예약에서 숨겼다.
- 표시 원칙: `이중확인 완료`는 `검사 준비 완료`가 아니다. 연결하지 않은 준비·약제·
  D-1·예약금·검진 값은 실제 값처럼 보여 주지 않고 안내 문구로 대신한다.
- 안내: 권한 부족, 1차 확인자와 같은 계정, 정보 변경 충돌을 한국어로 알리고, 충돌이면
  최신 확인 상태와 일정을 다시 불러온다. 권한이 없는 계정에는 버튼 대신 권한 안내를
  보여 준다.

## 3. 설계 결정과 가정

- PRD VER-002는 값 불일치도 `SECOND_REVIEWER_INVALID`로 적었다. 이번 구현은 화면을
  다시 읽으면 해결되는 불일치를 `VERIFICATION_STALE`로 나누고, 동일 계정만
  `SECOND_REVIEWER_INVALID`로 둔다. 비활성 계정은 인증 단계(401)에서 막힌다.
- 확인 방법은 `대면 문답`, `신분증 대조`, `전화 확인`, `차트·검진기록 대조` 네 가지로
  가정했다. 원내 확정이 필요하다.
- 무효화 대상은 PRD VER-004 목록에 이번 요청의 시작시각·세트60/90을 더했다.
- 환자 핵심정보가 바뀌어도 지난·취소 예약의 확인 기록은 당시 기록으로 두고 활성
  예약만 무효화한다.
- 2차 정정 API는 취소·No-show 예약의 잘못된 기록도 정정할 수 있게 두었다. 화면은
  활성 예약에서만 정정 버튼을 보여 준다.

## 4. 실행한 검사

| 검사 | 결과 |
|---|---|
| `scripts/verify.ps1` | 통과. Backend `ruff`, `mypy`(52개 파일), `pytest` 101개 통과·8개 skip(PostgreSQL 전용), `pip check`. Frontend `oxlint`, `tsc`(src·tests·e2e), Test 39개, Build |
| Backend 확인 API Test | 14개 통과: 두 직원 성공과 목록 상태, 관리자 포함 동일인 거절, 비활성 2차 확인자 거절, 권한·CSRF 차단, 1차 없는 2차 거절, 중복·낡은 요청, 사유 없는 정정 거절과 정정 뒤 재확인, 예약 핵심정보 변경 무효화와 과거 Snapshot 유지, 환자 핵심정보 무효화와 연락처·특이사항 변경 유지, 실패한 변경의 Rollback, 무효화의 같은 Transaction Rollback, 취소·No-show 거절, 검진 연도나이 Snapshot, 역할 권한 |
| PostgreSQL 16.14 전용 Test | 8개 통과(일회용 Container `endoscopy-os-pgtest-4a`, `endoscopy-os-pgtest-4a-final`, 끝난 뒤 삭제). 새로 더한 5개: 단계별 유효 확인 유일성, 동시에 들어온 같은 1차 두 건 중 하나만 유효, 확인과 예약 시각 변경·환자 이름 변경의 경합에서 낡은 유효 기록이 남지 않음, `20260918_0007`에서 `head`로 올릴 때 기존 관리자·원무 역할에 1차 권한 부여. 기존 3개(Migration과 ORM 차이, 동시 예약, UTC Session)도 통과 |
| `scripts/e2e.ps1` | Browser Test 3개 통과. 새 흐름: 주간 보드 업무 Queue 확인 → 관리자 1차(같은 계정 2차 버튼 비활성) → 다른 직원 별도 Session 2차 → 새로고침 뒤 유지 → 사유를 넣은 2차 정정 → 2차 재확인 → 관리자 예약 시각 변경 → 재확인 필요와 변경 사유 표시 |
| Frontend 단위 Test | 39개 통과. 새로 6개: 지문·방법·메모·CSRF 전송, 정정 요청, 한국어 오류 안내와 다시 불러오기 판단, `이중확인 완료` ≠ 준비 완료, 나이·성별 표기, 대기 목록 순서 |
| 로컬 미리보기 Browser QA | 일회용 PostgreSQL·`uvicorn`·Vite를 직접 띄워 Chrome 1440×900·1366×768로 확인. 캡처 9장과 QA 중 고친 문제 10건은 [QA 기록](./qa/2026-09-22-identity-verification.md)에 있다 |

## 5. 실행하지 않은 검사와 이유

- Docker Compose·Caddy HTTPS 전체 구성: Repository에 운영 Secret이 든 `.env`가 없고,
  운영 Secret을 임의로 만들지 않았다. 같은 Backend·Frontend를 로컬 서버로 띄워
  확인했다.
- 운영 Database Migration: 이번 범위에서 제외했다. 기존 Database 권한 반영은 일회용
  PostgreSQL에서 `20260918_0007` → `head` 업그레이드 Test로만 확인했다.
- 실제 원내 PC, Edge·Firefox, 태블릿·모바일 폭: 이번 개발 PC에는 설치된 Chrome만
  있었다.
- 여러 Backend Process·Worker에서의 동시성: 단일 `uvicorn` Process의 Thread 경합과
  PostgreSQL 행 잠금·부분 Unique Index로 확인했다. 운영과 같은 Process 구성의 부하
  시험은 하지 않았다.
- Git push와 외부 배포: 이번 범위에서 제외했다.

## 6. 남은 제한

- 준비 Gate(VER-004의 `409 VERIFICATION_REQUIRED`, PRO-002)는 준비 기능이 없어 아직
  없다. 준비 기능을 만들 때 유효한 이중확인을 Gate로 연결해야 한다.
- PACS 수기확인(VER-003)과 PACS 확인 무효화는 아직 없다.
- 확인 업무 목록과 업무 Queue는 오늘부터 14일만 본다. 그 밖의 예약은 달력에서 연다.
  업무 Queue는 역할과 관계없이 재확인 → 1차 → 2차 순으로 같은 목록을 보여 준다.
- 확인 방법 목록은 가정이다(3장).
- Alembic Schema 비교는 부분 Index의 `WHERE` 조건 차이를 비교하지 않는다.
  `uq_patient_verifications_valid_stage` 조건을 바꿀 때는 Migration과 Model을 함께
  확인해야 한다.
- 확인 기록은 업무 이력이며 변경 불가 영구 Audit Log가 아니다(Sprint 7).
- 오늘 화면(Dashboard)·통계·조직검체와 예약 상세의 준비·약제·결제 편집기는 여전히
  합성 Fixture 또는 저장하지 않는 Prototype이다.

## 7. 실행 환경 문제와 제품 결함

| 구분 | 내용 | 조치 |
|---|---|---|
| 실행 환경 | PowerShell cp949에서 Alembic 하위 Process 출력 해독 실패 | Test Harness UTF-8 처리(`9f9ae95`) |
| 실행 환경 | 미리보기 합성 Seed가 세트90 예약(09:00–10:30)과 겹치는 10:00에 예약을 넣으려 함 | 미리보기용 Seed 시각 수정(제품 코드 변경 없음) |
| Test 결함 | 새 E2E가 확인 업무 화면에 머문 채 주간 카드를 찾음 | Test가 주간 메뉴로 먼저 이동 |
| 제품 결함(새 코드, 커밋 전) | Migration `0008`의 권한 INSERT가 실제 PostgreSQL에서 `AmbiguousParameter`로 실패. SQLite Test는 통과했다 | 매개변수에 `CAST`를 붙이고 PostgreSQL Test로 확인 |
| 제품 결함(새 화면, 커밋 전) | Browser QA에서 찾은 10건. 실제 예약에 미연결 값·PACS 노출, Fixture 업무 Queue, 문구·줄바꿈, 권한 안내 없음 등 | 모두 수정([QA 기록](./qa/2026-09-22-identity-verification.md)) |
| 기존 제품 결함 | Sprint 3B 흐름에서 발견하지 못함 | — |

## 8. 커밋

- `9f9ae95` test: decode alembic subprocess output as UTF-8 on Windows
- `7b2c02b` feat: record primary and secondary identity verification per appointment
- `3a44362` feat: verify patient identity twice from real appointment details
- 이후 Browser QA 수정, Test 보강, 문서는 별도 커밋으로 남겼다. Push하지 않았다.
