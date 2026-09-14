# Phase 4 · Sprint 3A Backend Scheduling Core 구현 보고서

- 완료일: 2026-09-09
- 상태: Backend Vertical Slice 구현 및 자동화 Test 완료
- 범위: 기본 오전 가능 Slot, Appointment 저장·조회, 충돌·Capacity 차단

## 구현 완료

- 단일 `ENDOSCOPY_MAIN` Schedule Resource
- Patient UUID를 참조하는 Appointment와 독립 Procedure 행
- 위 단독 30분, 대장 단독·위대장 동시 60분
- 월·화·목·금 09:00~12:00와 위 5건·대장 3건 상한
- 수·토 09:00~11:00 운영시간
- 일요일, 30분 Grid 밖, 종료시각 초과, 기존 예약 중복 차단
- PostgreSQL Advisory Transaction Lock으로 같은 날짜 저장 직렬화
- PostgreSQL `btree_gist` Exclusion Constraint로 동일 Resource 중복 최종 차단
- 생성 당시 Schedule Policy Version과 Append-only 생성 History 보존
- 가능 Slot, 기간별 목록, 상세, 생성 REST API

## API

| Method | Endpoint | 설명 |
|---|---|---|
| `GET` | `/api/appointments/availability` | 날짜·검사 구성별 가능 Slot |
| `GET` | `/api/appointments` | 최대 31일 범위 예약 조회 |
| `GET` | `/api/appointments/{id}` | 예약 상세 조회 |
| `POST` | `/api/appointments` | Patient와 연결된 기본 오전 예약 생성 |

## 검증 결과

- Backend Unit·API·Migration 회귀 Test: 49개 통과
- SQLite Test DB에서 Domain·API·History 검증
- Alembic PostgreSQL offline SQL 생성 검증
- 기존 Starlette `TestClient` deprecation warning 1건은 유지

## 의도적으로 남긴 범위

- 14:00 오후 예외 승인과 등록자·확인자 분리
- 휴진·운영시간·Slot·Capacity 날짜별 Override
- 예약 변경·취소·No-show와 Revision
- React 일정·예약 Form의 실제 API 전환
- 실제 PostgreSQL 동시 요청 통합 Test

위 항목은 Sprint 3B에서 구현한다. 현재 React 일정 화면의 예약 데이터는 여전히
합성 Fixture와 Browser Memory를 사용하므로 운영 예약 화면으로 간주하지 않는다.

## 실행

```powershell
Push-Location backend
.\.venv\Scripts\pytest.exe -q
Pop-Location

docker compose up -d --build
docker compose ps
```

실제 환자정보는 Backup·Restore와 실장비 운영 Gate가 끝나기 전까지 입력하지 않는다.
