# Sprint 3B · Frontend API 연결 1차 구현 보고서

- 완료일: 2026-09-17
- 데이터: 합성 환자·합성 예약만 사용
- 연결 범위: 로그인 권한, 주간 예약 조회, 가능 Slot 조회, 예약 생성, 409 시간충돌 안내

## 실제 연결 범위

| 화면/기능 | Backend 연결 | 비고 |
|---|---|---|
| 직원 로그인·Session | 연결 | 기존 `/api/auth/*` Session·CSRF 사용 |
| 메뉴/새 예약 노출 | 연결 | `appointment.read`, `appointment.create`, `patient.read` 권한 기준 |
| 주간 일정 | 연결 | `GET /api/appointments`, 월~토 6일 범위 조회 |
| 예약 가능 시간 | 연결 | `GET /api/appointments/availability`, 날짜·검사·세트·예약 구분 전달 |
| 환자 확인 | 연결 | 입력한 합성 환자와 Patient API 결과가 이름·차트번호·생년월일·성별 모두 정확히 일치해야 저장 |
| 예약 생성 | 연결 | `POST /api/appointments`, CSRF 포함 |
| 동시 시간충돌 | 연결 | `409 TIME_CONFLICT` 시 Modal 유지, 가능 Slot 재조회, 사용자 안내 |

## Prototype 경계

- 주간 보드의 예약 핵심정보만 Backend 응답이다.
- 좌측 `오늘 우선 처리` Queue는 기존 합성 Fixture를 유지한다.
- 확인 업무, 조직검사, 약제, D-1, 예약금, PACS와 상세 운영정보는 정적 Prototype이다.
- 신규 예약 Modal에서 위 항목은 UI 시안으로 남아 있으며 이번 단계에는 저장하지 않는다.
- Backend 예약의 변경·2차 확인 편집은 화면에서 막고 다음 연결 단계임을 안내한다.
- 월간·일간·통계 화면은 아직 기존 합성 Fixture 기반이다.

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
