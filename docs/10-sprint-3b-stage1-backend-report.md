# Phase 4 · Sprint 3B 1단계 Backend 구현 보고서

- 완료일: 2026-09-15
- 상태: Backend API·Migration·자동화 Test 완료, Frontend 전환(2단계) 전
- 범위: 날짜별 일정 예외, 14:00 오후 예외 확인, 예약 변경·취소·No-show

## 이번에 확정해 반영한 Decision

| Decision | 반영 내용 |
|---|---|
| DEC-16 | 일정 변경은 같은 Appointment의 Revision. `row_version`으로 동시 수정을 막고 변경 전후 값을 History에 남긴다. |
| DEC-19 | 날짜별 운영 종료시각을 바꾸면 마지막 시작시각은 종료시각−점유시간으로 자동 계산된다. |
| DEC-20 | 날짜별 운영시간은 30분 경계만 허용한다. |
| DEC-21 | 오후 예외는 등록자와 다른 User만 확인할 수 있다. Database CHECK 제약으로도 막는다. |

## 구현 완료

### 날짜별 일정 예외 (`schedule_date_overrides`)

- Rule 종류: `CLOSED`(휴진), `OPERATING_HOURS`(운영시간), `CAPACITY`(위·대장 수용량), `AFTERNOON_ALLOW`(14:00 오후 예외 허용)
- 등록(`PENDING`) → 승인(`APPROVED`) → 취소(`REVOKED`) 흐름. 모든 변경에 사유와 사용자·시각이 남는다.
- 같은 날짜·종류의 새 Rule을 승인하면 기존 Rule을 덮어쓰지 않고 `SUPERSEDED`로 대체한다. 승인된 Rule은 날짜·종류마다 하나만 존재한다(Partial Unique Index).
- DEC-03 우선순위로 해석한다: 휴진 → 운영시간 → 수용량 → 요일 기본 규칙 → 오후 예외.
- 일요일에는 휴진 외 Rule을 만들 수 없고, 오전 운영시간은 14:00 이전에 끝나야 한다.
- 승인·취소 응답에 새 규칙과 어긋나게 된 기존 예약 목록(ID·시간·검사·사유 종류, 환자 이름 제외)을 돌려준다. 기존 예약은 자동 취소·이동하지 않는다.
- 예약에는 적용된 Rule이 포함된 `schedule_policy_version`이 저장된다(예: `BASE-2026-07-30+H1a2b3c`).

### 14:00 오후 예외

- `AFTERNOON_ALLOW`가 승인된 날짜에만 14:00 시작으로 등록할 수 있고 사유가 필수다.
- 오전 Capacity와 독립적이며 날짜당 1명이다. 확인 대기 상태도 Slot을 점유한다.
- 확인은 `schedule_override.approve` 권한이 있는 다른 직원이 메모와 함께 한다.
- 확인된 오후 예외의 날짜·시간·검사를 바꾸면 확인이 해제되고, 변경한 직원이 아닌 다른 직원이 다시 확인해야 한다.

### 예약 변경·취소·No-show

- 변경: 날짜·시작시각·검사 구성·수면·세트·검진/일반 구분. 자기 예약은 충돌 검사에서 제외하고, 변경 전 날짜와 새 날짜를 모두 잠근 뒤 재검증한다.
- 취소: `CANCELLED` 전환으로 Slot과 Capacity를 즉시 해제한다. 행은 삭제하지 않는다.
- No-show: 예약 시작시각이 지난 뒤에만 기록할 수 있고 Slot을 해제한다.
- `occupies_slot`은 `BOOKED`일 때만 참이 되도록 Database CHECK로 강제한다(DEC-04).
- 모든 변경은 `appointment_history_events`에 `CREATED`·`UPDATED`·`CANCELLED`·`NO_SHOW`·`EXCEPTION_CONFIRMED`로 남는다.

## API

| Method | Endpoint | Permission |
|---|---|---|
| `PATCH` | `/api/appointments/{id}` | `appointment.update` |
| `POST` | `/api/appointments/{id}/cancel` | `appointment.cancel` |
| `POST` | `/api/appointments/{id}/no-show` | `appointment.no_show` |
| `POST` | `/api/appointments/{id}/confirm-exception` | `schedule_override.approve` |
| `GET` | `/api/appointments/{id}/history` | `appointment.read` |
| `GET` | `/api/schedule/day-policies` | `appointment.read` |
| `GET` | `/api/schedule/overrides` | `appointment.read` |
| `POST` | `/api/schedule/overrides` | `schedule_override.approve` |
| `POST` | `/api/schedule/overrides/{id}/approve` | `schedule_override.approve` |
| `POST` | `/api/schedule/overrides/{id}/revoke` | `schedule_override.approve` |

상태 변경 API는 모두 Origin·CSRF를 검증한다. 주요 오류 코드는 `STALE_ROW_VERSION`,
`APPOINTMENT_NOT_ACTIVE`, `APPOINTMENT_NO_CHANGES`, `NO_SHOW_TOO_EARLY`,
`AFTERNOON_NOT_ALLOWED`, `AFTERNOON_LIMIT_EXCEEDED`, `EXCEPTION_CONFIRMER_MUST_DIFFER`,
`INVALID_OVERRIDE_VALUE`, `OVERRIDE_NOT_PENDING`이다.

## Migration

- `20260916_0005`: `schedule_date_overrides` 생성, Appointment 오후 예외 열 추가, 상태·History CHECK 확장
- 이전 Migration의 CHECK 제약은 Naming Convention이 이름에 한 번 더 붙은 상태(`ck_appointments_ck_appointments_...`)로 만들어져 있어, 실제 이름으로 삭제한 뒤 새 이름으로 다시 만든다.
- Downgrade는 `NO_SHOW` 행이나 새 History Event가 있으면 실패하므로 운영 Database에서는 Backup 후에만 실행한다.

## 검증 결과

- SQLite 기반 Backend Test: 70개 통과
  - 신규 `test_appointment_changes_api.py` 10개: Revision·이력, `row_version` 충돌, 취소 후 Capacity 해제, No-show 시각 제한, 휴진·운영시간·수용량 Rule, Rule 대체, 잘못된 Rule 거절, 오후 예외 등록·확인자 분리·재확인
- 실제 PostgreSQL 16.14 통합 Test: 2개 통과 (`TEST_POSTGRES_URL` 지정 시 실행)
  - 새 Migration의 upgrade → downgrade → upgrade
  - 같은 Slot 동시 예약 두 건 중 한 건만 성공
  - Database Session Timezone이 UTC여도 09:00 예약이 09:00으로 조회·충돌 검사·변경됨

```powershell
docker run -d --rm --name endoscopy-os-pgtest -e POSTGRES_PASSWORD=<시험용> -p 127.0.0.1:55432:5432 postgres:16.14-alpine
$env:TEST_POSTGRES_URL = "postgresql+psycopg://postgres:<시험용>@127.0.0.1:55432/postgres"
Push-Location backend
.\.venv\Scripts\pytest.exe -q tests\test_postgres_integration.py
Pop-Location
docker stop endoscopy-os-pgtest
```

이 Test는 대상 Database의 `public`·`iam` Schema를 지우므로 시험 전용 Container에만 사용한다.

## 의도적으로 남긴 범위

- **2단계**: React 월간·주간·일간 일정과 예약 Form을 실제 API로 전환, 일정 예외 관리 화면
- 시간대 단위 Slot 차단(`blocked_time_slots`)과 오후 추가 Slot(`ADD_SLOT`)
- 일정 예외 승인자와 등록자 분리 여부(현재는 권한만 검사)
- 취소·No-show 누적 3회 경고(DEC-15 미확정)
- 핵심정보 변경 시 1·2차·PACS 확인 무효화(Sprint 4)
- 영구 Audit Log(Sprint 7)

실제 환자정보는 Sprint 7 Backup·Restore와 실장비 운영 Gate가 끝나기 전까지 입력하지 않는다.
