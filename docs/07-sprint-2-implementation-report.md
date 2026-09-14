# Phase 4 · Sprint 2 구현 보고서

- 완료일: 2026-07-31
- 상태: 합성 데이터 기반 구현·개발 PC Docker 통합 검증 완료
- 범위: Patient 등록·검색·중복 차트번호 검사·기본정보 변경 History
- 다음 단계: Sprint 3 Scheduling Engine 검토 전 대기

> 이 완료 판정은 개발 승인이다. 실제 환자정보 운영 승인이 아니다.

## 1. 구현 완료 기능

### Patient Domain

- 내부 UUID Patient ID
- 앞자리 `0`을 보존하는 차트번호 원본과 검색·중복 검사용 정규화값 분리
- Database Unique Constraint를 이용한 최종 중복 차단
- 이름·생년월일·성별 필수 검증
- 연락처 선택 입력과 형식 검증
- 이름+생년월일+성별 동일 후보 경고
- 환자 물리 삭제 금지, 비활성화·재활성화
- 동시 수정 충돌 방지를 위한 `row_version`
- 취소·No-show Cache 초기값과 3회 이상 검토 표시 구조

### 나이 계산

- `SCREENING_YEAR_AGE`: 검사연도에서 출생연도를 뺀 값
- `FULL_AGE`: 기준일의 생일 경과 여부를 반영한 만 나이
- 2월 29일 출생자는 비윤년 3월 1일에 만 나이가 증가
- Patient Table에는 나이 Column이 없음
- 환자 검색 화면은 예약 유형이 없으므로 오늘 기준 만나이를 표시
- Sprint 3 예약 화면에서는 일반·검진 구분에 따라 계산방식을 선택할 예정
- 모든 나이 표시 옆에 성별 `남/여` 표시

### 개인정보 보호

- 연락처와 특이사항은 `bytea` 암호문으로 저장
- PostgreSQL `pgcrypto`의 AES-256 기반 대칭키 암호화 사용
- `FIELD_ENCRYPTION_KEY`는 Session Secret과 분리
- 환자 목록 API에는 연락처·특이사항 미포함
- 환자 상세 API에서만 복호화
- Patient History에는 연락처·특이사항 원문을 복제하지 않고 입력 여부만 저장
- Browser LocalStorage·SessionStorage 미사용

### Patient History

- 신규 등록, 정보 정정, 비활성화, 재활성화 Event 보존
- 변경 필드, 변경 전·후 Snapshot, 변경 사유, 실행 사용자, 실행 시각 저장
- 변경이력 API를 통한 최신순 조회
- History Event 물리 삭제 API 없음

### Frontend

- 이름·차트번호 부분검색
- 생년월일·성별 검색 Filter
- 관리자용 비활성 환자 포함 Filter
- 목록과 상세 Panel 분리
- 나이 옆 성별 즉시 표시
- 신규 환자 등록 Modal
- 차트번호 사용 가능 여부 사전 확인
- 환자정보 정정과 변경 사유 필수 입력
- 기본정보 변경 History Timeline
- 동명이인 가능성 Warning Banner
- 비활성화·재활성화 사유 입력
- 조회 전용 사용자에게 변경 Control 미노출

## 2. 주요 Database 변경

| Table | 용도 |
|---|---|
| `patients` | 환자 최신 기본정보, 암호문, 파생 Count, 활성상태 |
| `patient_history_events` | 환자정보 정정 경위를 보존하는 Append-only History |

Alembic Revision은 `20260731_0002`이다. Migration은 `pgcrypto` Extension을
설치하고 위 두 Table과 Index·Check·Foreign Key·Unique Constraint를 생성한다.

## 3. REST API

| Method | Endpoint | Permission | 설명 |
|---|---|---|---|
| `GET` | `/api/patients` | `patient.read` | 환자 최소정보 검색 |
| `POST` | `/api/patients` | `patient.create` | 환자 등록 |
| `GET` | `/api/patients/chart-number-availability` | `patient.read` | 차트번호 중복 확인 |
| `GET` | `/api/patients/{id}` | `patient.read` | 상세정보 조회 |
| `PATCH` | `/api/patients/{id}` | `patient.update` | 사유 포함 정보 정정 |
| `GET` | `/api/patients/{id}/history` | `patient.read` | 기본정보 History |
| `GET` | `/api/patients/{id}/age` | `patient.read` | 나이 계산 |
| `PATCH` | `/api/patients/{id}/activation` | `patient.update` | 비활성화·재활성화 |

모든 변경 요청은 Session, Backend Permission, Origin, CSRF Token을 다시
검증한다.

## 4. 합성 Seed

`backend/app/cli/seed_patients.py`는 `SYN-PT-` 접두사의 합성 환자 네 명을
멱등성 있게 생성한다. 전화번호와 임상 결과는 포함하지 않는다.

```powershell
docker compose --profile tools run --rm seed-patients
```

실제 환자 초기입력이나 Excel 이관 Script가 아니다. 승인된 DEC-28에 따라 과거
Excel은 조회용으로 보관하고 신규 운영일부터 새 시스템에 직접 입력한다.

## 5. Test 결과

| 검증 | 결과 |
|---|---|
| Backend Unit·API·Migration·Seed Test | 40개 통과 |
| Frontend TypeScript Type Check | 통과 |
| Frontend Production Build | 통과 |
| Sites Artifact Test | 4개 통과 |
| Frontend Dependency Audit | 취약점 0건 |
| Docker Image Build | 통과 |
| PostgreSQL Migration | Revision `20260731_0002` 통과 |
| `pgcrypto` 설치 | 통과 |
| 연락처·특이사항 암호문 저장 | 평문 비포함 확인 |
| API 등록·검색·상세 복호화·History | 통과 |
| 중복 차트번호 | 순차·동시 요청 모두 `409` 차단 |
| 동시 차트번호 등록 | 한 요청 `201`, 다른 요청 `409` |
| Runtime DB 계정 DDL 차단 | 통과 |
| Backend 재시작 후 Patient 유지 | 통과 |
| 실제 Browser 1366×768 | 검색·등록·정정·History 통과 |
| Browser Storage | LocalStorage·SessionStorage 0건 |

Browser Console의 유일한 `401 /api/auth/me`는 로그인 전 익명 Session 확인에서
발생하는 예상 응답이다.

## 6. 수정 파일

| 구분 | 주요 파일 |
|---|---|
| Model | `backend/app/models/patient.py` |
| Schema | `backend/app/schemas/patient.py` |
| Service | `backend/app/services/patients.py` |
| Router | `backend/app/api/routers/patients.py` |
| Presenter | `backend/app/api/patient_presenters.py` |
| Migration | `migrations/versions/20260731_0002_create_patient_schema.py` |
| Seed | `backend/app/cli/seed_patients.py` |
| Frontend | `frontend/src/PatientWorkspace.tsx`, `frontend/src/patients.ts` |
| Test | `backend/tests/test_patient_domain.py`, `test_patients_api.py`, `test_seed_patients.py` |
| Deployment | `.env.example`, `docker-compose.yml` |

## 7. 실행·검증 명령

```powershell
$env:APP_ENV = "test"
$env:PYTHONPATH = (Join-Path (Get-Location) "backend")
.\backend\.venv\Scripts\python.exe -m pytest backend\tests -q

Push-Location frontend
npm run typecheck
npm run build
npm run test:sites
npm audit --audit-level=high
Pop-Location

docker compose config --quiet
docker compose up -d --build
docker compose ps
```

## 8. Architecture Decision

### ADR-S2-001 · Patient 민감 필드 암호화

- 결정: PostgreSQL `pgcrypto`로 연락처·특이사항을 Column 단위 암호화한다.
- 이유: 검증되지 않은 자체 암호화 코드를 작성하거나 새 Python Production
  Dependency를 무단 추가하지 않으면서 Local PostgreSQL Backup의 평문 노출을
  줄일 수 있다.
- Trade-off: Database Process가 복호화 연산을 수행하므로 Application 전용
  AEAD보다 Database 관리자 위협에 약하다.
- 보완: Database와 Key를 분리하고, Query Parameter와 일반 Log를 기록하지
  않으며, Runtime DB 계정의 DDL을 차단한다.
- 재검토: 실제 운영 보안 검토에서 Application-level AEAD가 필요하다고
  판단되면 별도 승인 후 암호화 Migration을 설계한다.

## 9. 미구현 항목

- Appointment와 연결된 과거 예약·변경·취소 History
- 환자별 예약 제한 결정과 종료일: Sprint 5
- 전체 변경을 포괄하는 Audit Log: Sprint 7
- Excel 과거 자료 Import: DEC-28에 따라 구현 대상 아님
- 실제 환자정보를 사용하는 운영 전환

## 10. 알려진 위험과 다음 Gate

- `FIELD_ENCRYPTION_KEY`를 분실하면 연락처와 특이사항을 복호화할 수 없다.
- Database Backup만 보관하고 Key를 잃으면 복원이 불완전하다. Key는 Backup과
  분리해 이중 보관해야 한다.
- 개발 PC Disk 암호화가 꺼져 있어 실제 환자정보를 입력하면 안 된다.
- 실제 접수실 Main PC와 다른 원내 PC의 HTTPS·재부팅·자동기동 Test가 남았다.
- Sprint 7 Backup·Restore Test 전에는 실제 운영 승인을 할 수 없다.
- Sprint 3 진입 전에는 이 Sprint 2 결과를 검토하고 승인받는다.
