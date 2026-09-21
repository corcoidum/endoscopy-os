# Sprint 3B · Frontend API 연결 1차 구현 보고서

- 1차 완료일: 2026-09-17 · 후속 정리: 2026-09-21
- 데이터: 합성 환자·합성 예약만 사용
- 연결 범위: 로그인 권한, 월간·주간·일간 예약 조회, 날짜별 일정 규칙, 가능 Slot 조회,
  예약 생성, 당일 위내시경·연장 슬롯, 409 시간충돌 안내

## 실제 연결 범위

| 화면/기능 | Backend 연결 | 비고 |
|---|---|---|
| 직원 로그인·Session | 연결 | 기존 `/api/auth/*` Session·CSRF 사용 |
| 메뉴/새 예약 노출 | 연결 | `appointment.read`, `appointment.create`, `patient.read` 권한 기준 |
| 월간·주간·일간 일정 | 연결 | `GET /api/appointments`, 월간 6주 Grid도 1회 조회(최대 42일) |
| 날짜별 일정 규칙 | 연결 | `GET /api/schedule/day-policies`로 휴진·운영시간·수용량·오후 예외 허용을 받아 보드와 예약 Form의 판정 기준으로 사용 |
| 예약 가능 시간 | 연결 | `GET /api/appointments/availability`, 날짜·검사·세트·예약 구분 전달 |
| 환자 확인 | 연결 | 입력한 합성 환자와 Patient API 결과가 이름·차트번호·생년월일·성별 모두 정확히 일치해야 저장 |
| 예약 생성 | 연결 | `POST /api/appointments`, CSRF 포함 |
| 동시 시간충돌 | 연결 | `409 TIME_CONFLICT` 시 Modal 유지, 가능 Slot 재조회, 사용자 안내 |
| 당일 위내시경·연장 슬롯 | 연결 | 오전 일반 Slot이 모두 찼을 때 관리자가 30분 연장 슬롯을 승인하고 그 슬롯에 예약 |

## Prototype 경계

- 월간·주간·일간 보드의 예약 핵심정보만 Backend 응답이다.
- 좌측 `오늘 우선 처리` Queue는 기존 합성 Fixture를 유지한다.
- 확인 업무, 조직검사, 약제, D-1, 예약금, PACS와 상세 운영정보는 정적 Prototype이다.
- 신규 예약 Modal에서 위 항목은 UI 시안으로 남아 있으며 이번 단계에는 저장하지 않는다.
- Backend 예약의 변경·2차 확인 편집은 화면에서 막고 다음 연결 단계임을 안내한다.
- 오늘 화면·확인 업무·통계·조직검체는 아직 기존 합성 Fixture 기반이다.
- 예약 변경·취소·No-show·이력 조회, 오후 예외 확인, 일정 예외 관리 화면은
  Backend API만 있고 화면 연결이 남아 있다.

## 오류·복구 흐름

```text
예약 저장
→ Patient API 정확 일치 확인
→ POST /api/appointments
→ 201: 주간 목록 재조회·보드 반영
→ 409 TIME_CONFLICT: Modal 유지·Slot 재조회·다른 시간 선택 안내
→ 401: 기존 Session 만료 처리
→ 403: Backend 권한 오류 표시
```

## 검증 결과

- `npm run typecheck`: 통과
- `npm test`: 6개 통과
  - Draft→Backend 검사/수면 코드 변환
  - Backend 응답→주간 화면 모델 변환과 Prototype 경계
  - CSRF 포함 예약 생성 Payload
  - 가능 Slot Query 계약
  - `409 TIME_CONFLICT` 코드 보존
  - 409 사용자 안내 문구
- `npm run build`: 통과, `dist/client/index.html` 생성
- Backend `pytest -q`: 70개 통과, PostgreSQL 전용 2개 skip
- 실제 Browser smoke test(합성 SQLite 임시 서버 + Vite):
  - 합성 관리자 로그인과 권한 메뉴 확인
  - 주간 일정 `GET` 200 확인
  - 가능 Slot `GET` 200과 토요일 세트60 Slot 확인
  - 합성 환자 정확 일치 `GET` 200 확인
  - 예약 생성 `POST` 201 확인
  - 저장 예약이 주간 보드 환자 1건으로 반영됨을 확인
  - 유효한 `409 TIME_CONFLICT` 응답에서 Modal 유지, Slot 재조회, 한국어 안내 확인

## 검증 제한

- Docker Compose는 Repository `.env`가 없어 필수 Host/DB/Session/Encryption 설정 검사에서 중단됐다. 운영 비밀값은 임의 생성하지 않았다.
- 실제 PostgreSQL 통합 Test 2개는 `TEST_POSTGRES_URL` 미지정으로 이번 실행에서 skip됐다.
- Browser smoke test의 409 응답은 UI 오류 처리 확인을 위해 Playwright에서 유효한 Backend 오류 JSON으로 재현했다. 실제 Backend의 시간충돌 409는 Backend API 자동화 Test가 별도로 검증한다.

## 후속 정리 (2026-09-21)

1차 연결 이후 Code Review에서 나온 결함 수정과 품질 기준 도입을 정리한다.

### 결함 수정

- 당일 연장 슬롯 예약을 취소하면 그 슬롯을 다시 예약할 수 없고, 취소한 슬롯과
  같은 시각에 새 슬롯도 열 수 없던 문제를 고쳤다. 유일성 제약을 Slot을 점유 중인
  예약과 승인된 슬롯에만 거는 부분 Unique Index로 바꿨다(Migration `20260918_0007`).
- 승인된 연장 슬롯이 여럿이면 첫 슬롯 하나로 목록이 좁혀져 다른 슬롯을 고를 수
  없던 문제를 고쳤다.
- 연장 슬롯 개설에서 남은 일반 Slot 검사를 날짜 잠금 뒤로 옮겨 동시 요청 두 건이
  모두 통과하던 경합을 없앴다.
- 당일 예약 변경, 환자 나이 계산, 생년월일 검증이 Server Timezone이 아니라 서울
  기준 날짜를 쓰게 했다.
- 합성 환자·예약 Seed가 `APP_ENV=production`에서 실행되면 중단한다.
- Frontend가 요일 규칙을 상수로 들고 있어 관리자가 승인한 날짜별 예외를 모르던
  문제를 `day-policies` 조회로 해소했다.

### 구조와 품질 기준

- `App.tsx`(4,953줄)를 기능별 Module 13개로 나눴다(883줄). 동작은 바꾸지 않았다.
- `scripts/verify.ps1`에 Backend `ruff`·`mypy`, Frontend `oxlint`와 Test Type 검사를
  더했다. Frontend Lint는 `typescript-eslint`가 TypeScript 7을 지원하지 않아
  `oxlint`를 쓴다.
- 서울 기준 시각 Helper를 `app/core/clock.py`로 옮겼다.

### 검증 결과

- `scripts/verify.ps1`: 통과
  - Backend: `ruff` 통과, `mypy` 46개 파일 이상 없음, `pytest` 86개 통과(PostgreSQL 전용 3개 skip)
  - Frontend: `oxlint` 통과, `tsc`(src·tests) 통과, Test 21개 통과, Build 통과
- 실제 PostgreSQL 16.14 통합 Test: 3개 통과
  - 일회용 `postgres:16.14-alpine` Container에서 실행했다.
  - Migration `head` 적용, `20260915_0004`까지 Downgrade 후 재적용 확인
  - 부분 Unique Index가 `WHERE` 조건과 함께 생성되고 이전 Unique 제약이 사라진 것을 확인
  - Migration을 적용한 Schema와 ORM metadata 비교에서 차이 없음. 일부러 Model에만
    Column을 더하면 차이를 잡는 것도 확인했다.
  - 동시 예약 1건만 성공, UTC Session에서 서울 시각 유지

### 남은 제한

- Alembic의 Schema 비교는 부분 Index의 `WHERE` 조건 차이까지는 비교하지 않는다.
  조건을 바꿀 때는 Migration과 Model을 함께 확인해야 한다.
- 예약 변경·취소·No-show·이력, 오후 예외 확인, 일정 예외 관리 화면 연결이 이
  단계의 남은 범위다.
- Frontend Test는 순수 함수 단위만 있다. 상태를 바꾸는 흐름을 연결할 때 Browser
  Smoke Test를 함께 둔다.
