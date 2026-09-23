# Sprint 4B 대장내시경 복용약 확인·의사 결정 보고서

- 작업일: 2026-09-23
- 데이터: 합성 환자·합성 직원 계정·합성 약 이름만 사용
- 요구사항: PRD MED-002~005, 설계 문서 5.3(`medication_reviews`·`medication_items`),
  UI 명세의 약제 상태 표시, `frontend/AGENTS.md`의 예약 등록 5단계 결정
- 범위 밖: 약제 Master(MED-001), 준비 완료 Gate(PRO-002), PACS 수기확인, 장정결제·
  추가 검사·D-1·예약금, Git push·외부 배포·운영 Database 변경
- 관련 QA 기록: [2026-09-23 복용약 확인·의사 결정 QA](./qa/2026-09-23-medication-review.md)

## 1. 이번 단계로 고른 이유

Sprint 4에 남은 항목 중 PACS 수기확인은 검사 시작 Gate 여부(DEC-31)가 정해지지 않았고,
화면에서도 PACS를 숨기기로 했다. 복용약 확인은 요구사항이 가장 구체적이고 준비 Gate의
전제이며, 예약 등록 5단계가 복용약·의사 중단 결정을 받으면서도 실제 예약에는 저장하지 않고
있었다. 그래서 복용약 확인과 약별 의사 결정을 먼저 실제 기록으로 연결했다.

## 2. 구현 범위

### Backend

**저장 구조** — Migration `20260923_0009`

| Table | 내용 |
|---|---|
| `medication_reviews` | 예약별 복용약 확인 Checklist 하나. 목록 확인·복용약 없음 확인·확인 전, 전체 복용약 목록, 복용 분류 6가지(항응고제·항혈소판제·혈액순환제·심장약·신경계 약·만성질환 약), 수술 이력, 심혈관 시술 이력, EMR 기록, 확인자·시각, `row_version` |
| `medication_review_revisions` | Checklist를 저장할 때마다 전체 값을 암호화한 Snapshot으로 쌓는다 |
| `medication_items` | 중단 검토 약별 결정 Revision. 결정 대기·중단(1~90일)·복용 지속(사유 필수), 결정 의사 Profile, 입력 사용자·시각, 결정 당시 검사일, 환자 안내, 실제 중단 확인, 대체·철회 정보 |

- 설계 문서의 `pre_procedure_assessments`와 `medication_reviews`를 `medication_reviews`
  하나로 합쳤다. 의사 확인을 약마다 남기므로 검토 단위 의사 확인 열이 필요 없다.
- 결정은 행을 고치지 않고 새 Revision으로 쌓는다. 이전 결정은 `SUPERSEDED`, 철회는 사유와
  함께 `WITHDRAWN`으로 남는다. 약마다 유효한 Revision은 하나뿐이다(부분 Unique Index
  `uq_medication_items_active_item`).
- CHECK 제약: 복용약 없음과 복용 분류 동시 표시 금지, 목록 확인에는 목록 필수, 결정이 있으면
  결정 의사와 결정 당시 검사일 필수, 중단은 1~90일, 복용 지속은 사유 필수, 환자 안내는 결정
  뒤에만, 실제 중단 확인은 중단 결정에만.
- 전체 복용약 목록·수술 이력·심혈관 시술 이력·약 이름·사유·Revision Snapshot은 `pgcrypto`로
  암호화한다. 환자 연락처와 같은 암호화 Helper를 `app/services/field_crypto.py`로 옮겨 함께 쓴다.

**상태** — 예약 목록·상세 응답에 `medication_state`를 더했다.

| 상태 | 뜻 |
|---|---|
| `NOT_REQUIRED` | 대장내시경이 없고 기록도 없다 |
| `CHECK_REQUIRED` | 대장내시경이 있는데 복용약 확인 전이다 |
| `PHYSICIAN_REQUIRED` | 의사 결정을 기다리는 중단 검토 약이 있다 |
| `RE_REVIEW_REQUIRED` | 결정 당시 검사일과 지금 검사일이 다르다 |
| `NOTIFICATION_REQUIRED` | 현재 결정을 환자에게 안내했다는 기록이 없다 |
| `COMPLETE` | 확인과 결정 안내가 끝났다. 검사 준비 완료가 아니다 |

**API**

| Method | Endpoint | 권한 | 설명 |
|---|---|---|---|
| `GET` | `/api/appointments/{id}/medication-review` | `medication.read` | 상태, Checklist, 현재 결정, 전체 이력, 활성 의사 Profile |
| `PUT` | `/api/appointments/{id}/medication-review/checklist` | `medication.write` | Checklist 저장(`expected_row_version`) |
| `POST` | `/api/appointments/{id}/medication-review/items` | `medication.write` (+결정 시 `medication.decision`) | 중단 검토 약 추가, 의사 결정 동시 기록 가능 |
| `POST` | `…/items/{item_key}/decision` | `medication.decision` | 의사 결정을 새 Revision으로 기록 |
| `POST` | `…/items/{item_key}/withdraw` | `medication.write` | 사유를 남기고 철회 |
| `POST` | `…/items/{item_key}/notify` | `medication.write` | 환자 안내 기록 |
| `POST` | `…/items/{item_key}/hold-confirmation` | `medication.write` | 실제 중단 확인일 기록 |
| `GET` | `/api/staff-profiles/physicians` | `medication.read` | 활성 의사 Profile(예약 등록 화면용) |
| `GET`·`POST` | `/api/staff-profiles` | `identity.manage` | 직원·의사 명부 조회·등록 |
| `PATCH` | `/api/staff-profiles/{id}/activation` | `identity.manage` | 명부 비활성화·다시 활성화 |

변경 요청은 모두 기존 Session·CSRF·Permission 검사를 거친다. 쓰기는 예약 행을 잠그므로 같은
예약의 복용약 기록과 예약 변경이 한 줄로 선다. Checklist는 `row_version`, 약별 동작은
`expected_revision`으로 낡은 화면을 막는다(`409 MEDICATION_REVIEW_STALE`·
`409 MEDICATION_ITEM_STALE`).

**규칙**

- 결정에는 활성 의사 Profile과 "담당 의사가 결정한 내용" 명시 확인이 필요하다(아니면
  `422 PHYSICIAN_CONFIRMATION_INVALID`·`422 PHYSICIAN_CONFIRMATION_REQUIRED`). 입력한 로그인
  사용자와 결정 의사를 함께 남긴다(DEC-07).
- 검사일이 바뀌면 기존 결정은 그대로 두고 `재검토 필요`가 된다. 지난 결정으로는 환자 안내·
  실제 중단 확인을 받지 않으며(`409 MEDICATION_RE_REVIEW_REQUIRED`), 새 결정은 의사가 다시
  정해야 한다. 같은 날 안에서 시각만 바뀌면 결정은 유효하다.
- 환자 안내는 결정 뒤에만(`409 MEDICATION_DECISION_REQUIRED`), 실제 중단 확인은 중단 결정에만
  (`409 MEDICATION_HOLD_REQUIRED`), 확인일은 결정일부터 오늘·검사일 사이(`422`)만 받는다.
- 복용약 없음으로 확인하려면 남은 중단 검토 약을 먼저 철회해야 하고, 복용약 없음 상태에는 약을
  더할 수 없다. 취소·No-show 예약에는 새 기록을 받지 않는다.

**권한** — `medication.read`·`medication.write`·`medication.decision`을 새로 만들어 관리자·
원무·내시경 담당에 주었다. 기존 Database는 Migration이 세 역할에 부여한다. 조회 전용은 복용약
내용을 볼 수 없고, 예약 목록의 상태 표시만 본다.

**업무 이력과 영구 Audit의 구분** — 복용약 기록은 예약 업무 이력이다. 변경 불가 영구 Audit
Log는 Sprint 7 범위다.

### Frontend

- 예약 상세 `준비·약제` 탭: 복용약 확인 Panel(고정 안전 문구, 목록·없음 확인, 복용 분류,
  수술·심혈관 시술 이력, EMR, 중단 검토 약, 의사 결정 입력, 환자 안내, 실제 중단 확인, 철회
  두 단계, 이력). 결정 의사는 선택기 없이 활성 의사 Profile 이름으로 고정해 보여 준다.
- `업무 요약`: 복용약 상태 한 줄과 준비·약제 탭 바로가기.
- 예약 등록 5단계: `아직 확인 전`·`전체 복용약 목록 확인 완료`·`복용약 없음 확인`을 고르고, 복용
  분류를 표시한다. 약마다 1~90일과 담당 의사 확인이 필요하다. 새 실제 예약을 저장하면
  복용약 확인과 의사 결정을 함께 저장한다. 의사 확인한 약이 있는데 활성 의사 Profile이 정확히
  한 명이 아니면 예약을 만들기 전에 막는다.
- 주간 카드·일간 보드·왼쪽 업무 Queue·확인 업무 화면이 실제 복용약 상태를 보여 준다. 확인
  업무의 복용약 행을 누르면 준비·약제 탭으로 열린다.
- 관리자 화면: 의사 Profile 등록·비활성화·다시 활성화. 활성 의사가 둘 이상이면 경고한다.
- D-1·예약금·장정결제·추가 검사는 여전히 연결하지 않았다는 안내만 둔다.

## 3. 설계 결정과 확정이 필요한 가정

- **의사 결정 주체(DEC-32 미확정):** 원장이 직접 로그인하든 직원이 대신 입력하든, 입력 사용자와
  결정 의사를 함께 기록한다. 원장 1인 운영이라 선택기를 두지 않고 활성 의사 Profile 한 명을
  쓴다. 활성 의사가 없거나 둘 이상이면 결정 기록을 막고 관리자 설정을 안내한다.
- **복용 분류와 의사 검토 필요 판정:** 분류는 기록·표시만 한다. `의사 확인 필요`는 직원이
  중단 검토 약으로 올린 약이 결정 대기일 때 생긴다. 예컨대 항응고제·항혈소판제 분류만 표시하고
  검토 약을 올리지 않으면 목록 확인 뒤 `약제 확인 완료`가 된다. 특정 분류를 자동으로 의사 검토
  대상으로 볼지는 원내 결정이 필요하다.
- **중단 일수 1~90일:** 입력 오류를 막으려는 상한이다. 원내 기준 확인이 필요하다.
- **중단 시작 예정일:** 계산해 보여 주지 않는다. 의사가 정한 일수와 결정 당시 검사일만 남긴다.
  "검사 N일 전"을 날짜로 셀 때 당일 포함 여부 같은 기준은 원내에서 정해야 한다.
- **실제 중단 확인일:** 직원이 환자에게 중단을 확인한 날로 보고, 결정일부터 오늘·검사일 사이만
  받는다.
- **예약 등록 저장:** 예약을 만든 뒤 복용약을 이어서 저장한다(요청 두 번). 두 번째가 실패하면
  예약은 남기고, 상세 준비·약제에서 다시 입력하라고 9초간 안내한다.

## 4. 실행한 검사

| 검사 | 결과 |
|---|---|
| `scripts/verify.ps1` | 통과. Backend `ruff`, `mypy`(61개 파일), `pytest` 115개 통과·12개 skip(PostgreSQL 전용), `pip check`. Frontend `oxlint`, `tsc`(src·tests·e2e), Test 47개, Build |
| Backend 복용약 API Test | 14개 통과: 대장 예약의 확인 필요와 위 단독 대상 아님, 복용약 없음과 빈 목록 구분, Checklist Revision과 낡은 화면 거절, 결정 의사·입력자 기록, 활성 의사·명시 확인·일수·사유 검증과 실패 시 무기록, 권한·CSRF, 시각 변경은 유지·검사일 변경은 재검토, 안내·실제 중단 확인 규칙, 철회와 복용약 없음, Checklist 선행·활성 예약, 유효 Revision 중복 차단, 의사 명부 관리, 역할 권한 |
| PostgreSQL 16.14 전용 Test | 12개 통과(일회용 Container `endoscopy-os-pgtest-4b`, 끝난 뒤 삭제). 새로 4개: 복용약 텍스트가 Database에 평문으로 남지 않음, 유효 Revision 부분 Unique Index, 같은 약에 동시에 들어온 결정 두 건 중 하나만 유효, `20260922_0008`에서 `head`로 올릴 때 기존 세 역할에 권한 부여. Migration·ORM 차이 검사와 `20260915_0004`까지 Downgrade 후 재적용에 0009가 포함됐다 |
| `scripts/e2e.ps1` | Browser Test 4개 통과. 새 흐름: 복용약 목록·분류 저장 → 중단 검토 약 추가 → 의사 결정(명시 확인 전 저장 불가) → 환자 안내 → 실제 중단 확인 → 다른 Session의 검사일 변경 → 재검토 필요 → 의사 재결정 → 이력에 이전 결정 보존 |
| Frontend 단위 Test | 47개 통과. 새로 8개: Checklist·결정·안내·철회 요청 모양과 CSRF, 예약 등록 5단계 변환, 5단계 검증(1~90일·의사 확인·없음 확인·목록 필수), 활성 의사 한 명 규칙, 약제 상태 표시, 대기 목록 순서, 오류 안내와 다시 불러오기 |
| 로컬 미리보기 Browser QA | 일회용 PostgreSQL·`uvicorn`·Vite를 직접 띄워 Chrome으로 확인. 캡처 14장, 예약 등록으로 실제 예약과 복용약 저장, 의사 Profile이 없을 때 저장 차단까지 확인했다 |

## 5. 실행하지 않은 검사와 이유

- Docker Compose·Caddy HTTPS 전체 구성: Repository에 운영 Secret이 든 `.env`가 없고 운영
  Secret을 임의로 만들지 않았다.
- 운영 Database Migration: 이번 범위에서 제외했다. 기존 Database 권한 반영은 일회용
  PostgreSQL에서 `20260922_0008` → `head` 업그레이드 Test로만 확인했다.
- 실제 원내 PC, Edge·Firefox, 태블릿·모바일 폭: 이번 개발 PC에는 설치된 Chrome만 있었다.
- 여러 Backend Process 부하 시험: 하지 않았다. 동시 결정은 단일 Process의 Thread 경합과
  PostgreSQL 행 잠금·부분 Unique Index로 확인했다.
- 의사 여러 명 운영: 원장 1인 운영 결정에 따라 지원하지 않는다(활성 의사 둘 이상이면 결정 기록을 막음).
- Git push와 외부 배포: 이번 범위에서 제외했다.

## 6. 남은 제한

- 약제 Master(MED-001)가 없다. 약 이름은 직원이 적은 그대로 암호화해 남기며, 참고 중단기간은
  보여 주지 않는다. Master 내용은 원내 의사가 출처와 함께 입력해야 한다.
- 준비 완료 Gate(`409 MEDICATION_REVIEW_REQUIRED`, PRO-002)는 준비 기능이 없어 아직 없다.
  `medication_state`와 이중확인 상태를 Gate 입력으로 쓸 수 있다.
- 복용 분류로 의사 검토 대상을 자동 판정하지 않는다(3장).
- 예약 등록의 복용약 저장은 예약 생성과 한 Transaction이 아니다(3장).
- 예약 등록 2단계 달력의 날짜별 가능 수가 지금 화면이 불러온 예약만으로 계산돼 실제보다 많게
  보일 수 있다. Sprint 3B부터 있던 동작이며 별도 작업으로 넘겼다. 저장은 Backend가 다시 검사한다.
- 복용약 기록은 업무 이력이며 변경 불가 영구 Audit Log가 아니다(Sprint 7).
- Alembic Schema 비교는 부분 Index의 `WHERE` 조건 차이를 비교하지 않는다.

## 7. 실행 환경 문제와 제품 결함

| 구분 | 내용 | 조치 |
|---|---|---|
| Test 결함 | 새 SQLite Test가 같은 시각에 예약 두 건을 넣으려 해 시간충돌 | Test가 서로 다른 시각을 쓰게 수정 |
| Test 결함 | 새 Frontend 모듈의 확장자 없는 import를 Node Test Runner가 찾지 못함 | 기존 관례대로 `.ts` 확장자를 붙임 |
| 제품 결함(새 코드, 커밋 전) | 확인 업무 화면 새 구역 이름이 예약 상세 Panel 이름과 겹쳐 기존 E2E Locator가 둘을 함께 잡음 | 구역 이름 변경 후 E2E 4개 통과 |
| 제품 결함(새 화면, 커밋 전) | Browser QA에서 찾은 3건: 유효한 결정의 재결정 버튼 강조, 넓은 일수 입력칸, 의사 Profile 없을 때 최종 확인의 `저장 가능` 표시 | 모두 수정([QA 기록](./qa/2026-09-23-medication-review.md)) |
| 기존 제품 결함 | 예약 등록 달력의 날짜별 가능 수 | 이번 범위 밖이라 별도 작업으로 넘김 |
| 실행 환경 | Chrome 자동화 도구의 첫 입력·클릭이 가끔 반영되지 않음 | 좌표 클릭으로 다시 입력. 제품 문제 아님 |

## 8. 커밋

- `e9af007` feat: record colonoscopy medication checks and physician decisions
- `0596ad3` feat: connect colonoscopy medication checks to real appointments
- 이후 Browser QA 수정과 문서는 별도 커밋으로 남겼다. Push하지 않았다.
