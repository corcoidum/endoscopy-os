# Phase 4 · Sprint 1 구현 보고서

- 작성일: 2026-07-31
- 상태: 구현 및 개발 PC Docker 통합 검증 완료
- 범위: Repository 기반, Docker Compose, PostgreSQL, FastAPI, React,
  Alembic Migration, 사용자 로그인, Role과 Permission

> Sprint 2의 Patient 등록·검색·History는 시작하지 않았다. 현재 화면에 표시되는
> 환자정보는 기존 Prototype의 합성 데이터이며 Backend에 저장되지 않는다.

## 1. 확정된 요구사항

| 항목 | Sprint 1 적용 내용 |
|---|---|
| 운영 경계 | 외부 공개 없이 원내 유선 LAN에서만 Caddy HTTPS로 접근 |
| Application | React·TypeScript Frontend와 FastAPI Backend |
| Database | 원내 PostgreSQL, `iam` Schema에 인증·권한 Table 구성 |
| 로그인 | ID·Password, 평문 Password 저장 금지 |
| Session | Server-side Opaque Session과 HttpOnly Cookie |
| 권한 | 관리자, 원무 담당자, 내시경 담당자, 조회 전용 역할 기반 Backend RBAC |
| 개인정보 | LocalStorage·SessionStorage 사용 금지, 일반 Log에 민감값 기록 금지 |
| Test Data | 합성 계정만 사용, 실제 환자정보 미사용 |
| 변경 범위 | Sprint 1 이후 업무 기능은 구현하지 않음 |

## 2. 설계상 가정

- 최초 네 역할은 운영 기본 Master로 Seed한다. 사용자는 여러 역할을 가질 수 있다.
- 최초 관리자만 일회성 CLI로 만들고, 이후 사용자는 관리자 API로 등록한다.
- Browser와 API는 Caddy 아래에서 같은 Origin으로 서비스한다.
- 운영 Container는 한 대의 접수실 Main Windows PC에서 실행한다.
- 로그인 Session은 한 Application Instance에서 시작하지만, Token Hash를
  PostgreSQL에 저장하므로 Backend Instance 확장 가능성을 막지 않는다.
- Sprint 1에서는 환자·예약 Domain을 Database에 저장하지 않는다.

## 3. 설정 가능한 항목

`.env`에서 다음 값을 원내 환경에 맞게 변경할 수 있다.

| 설정 | 기본 예시 | 설명 |
|---|---|---|
| `CLINIC_HOSTNAME` | `endoscopy.clinic.local` | 내부 DNS 또는 hosts 이름 |
| `CLINIC_ALLOWED_SUBNETS` | 사설망 예시 | Backend 접근 허용 Subnet |
| `CADDY_ALLOWED_SUBNETS` | 사설망 예시 | Caddy 접근 허용 Subnet |
| `SESSION_IDLE_MINUTES` | 30분 | 미사용 Session 만료 |
| `SESSION_ABSOLUTE_HOURS` | 12시간 | Session 최대 수명 |
| `MAX_LOGIN_FAILURES` | 5회 | 계정 잠금 전 실패 횟수 |
| `LOGIN_LOCK_MINUTES` | 15분 | 로그인 잠금 시간 |

Database 세 계정의 Password와 `SESSION_SECRET`은 운영자가 각각 별도 난수로
설정해야 한다.

## 4. 구현 완료 기능

### 4.1 Infrastructure

- Caddy만 Host TCP 443에 노출
- PostgreSQL과 FastAPI Host Port 비공개
- `edge`, `application`, `database` Network 분리
- PostgreSQL 관리자·Migration·Runtime 계정 분리
- Migration 완료 후 Backend가 시작되는 Dependency와 Healthcheck
- Caddy 내부 CA 기반 HTTPS, 보안 Header, 허용 Subnet Matcher
- 운영 Access Log 비활성화
- Container Read-only Filesystem, 임시 Directory, Linux Capability 최소화

### 4.2 Backend

- FastAPI Application Factory와 기능별 Router
- SQLAlchemy 2.0, psycopg 3, PostgreSQL 연결
- `User`, `StaffProfile`, `Role`, `Permission`, `UserRole`,
  `RolePermission`, `UserSession` Model
- Argon2id Password Hash
- Session 원문 대신 HMAC-SHA256 Hash만 Database에 저장
- HttpOnly·Secure·SameSite Strict Cookie
- CSRF Token 검증과 Rotation
- Idle·Absolute 만료와 Session IP Binding
- 로그인 실패 누적과 계정 잠금
- Password 변경 후 다른 Session 폐기
- 최초 로그인 임시 Password 변경 전 모든 업무 Permission 차단
- Permission 단위 Backend RBAC
- 내부 Subnet, Trusted Proxy, 허용 Host·Origin 검증
- 직원용 한국어 오류 응답
- Password 입력값을 Validation 오류에 다시 노출하지 않는 예외 처리
- 운영 환경의 Placeholder Secret 기동 차단

### 4.3 Frontend

- 시작 시 `/api/auth/me`로 기존 Session 확인
- 실제 Login·Logout API 연동
- Cookie 요청의 `credentials: include` 적용
- CSRF Token을 React Memory에만 보관
- 로그인 대기·실패·서버 연결 실패·Session 만료 화면
- 최초 로그인 Password 강제 변경 화면
- 실제 사용자 표시 이름과 역할 표시
- Permission 기반 메뉴·작업 Button 노출 제어
- Server Session 만료시각 기반 자동 화면 잠금
- Logout 통신 실패 시에도 화면의 사용자 정보 제거
- 기존 Option 2 Queue-First Prototype, 나이 옆 성별, 합성 데이터 보존

### 4.4 Migration과 초기화

- `iam` Schema와 인증·권한 Table 전체를 만드는 초기 Alembic Migration
- 고정 Permission·역할 Master의 멱등성 Seed
- 최초 관리자 생성 CLI
- 활성 관리자가 이미 있으면 CLI의 두 번째 관리자 생성 차단
- Password 원문 미출력

## 5. 주요 수정 파일

| 구분 | 파일 |
|---|---|
| 전체 안내 | `README.md`, `.env.example`, `.dockerignore`, `.gitignore`, `.gitattributes` |
| Compose | `docker-compose.yml` |
| Backend | `backend/app/`, `backend/requirements*.txt`, `backend/Dockerfile` |
| Authentication | `backend/app/core/security.py`, `backend/app/services/auth.py`, `backend/app/api/routers/auth.py` |
| RBAC | `backend/app/models/iam.py`, `backend/app/services/users.py`, `backend/app/api/routers/users.py` |
| Seed | `backend/app/cli/seed_identity.py` |
| Migration | `alembic.ini`, `migrations/` |
| Frontend Auth | `frontend/src/api.ts`, `frontend/src/auth.tsx`, `frontend/src/App.tsx` |
| Frontend Build | `frontend/Dockerfile`, `frontend/tsconfig.json`, `frontend/vite.config.mjs` |
| Caddy | `deployment/caddy/` |
| PostgreSQL 초기화 | `deployment/postgres/` |

## 6. 실행 명령

### 6.1 운영 후보 구성

```powershell
Copy-Item .env.example .env
notepad .env

docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

최초 관리자 생성은 `README.md`의 SecureString 예제를 사용한다. 관리자 Password를
`.env`에 저장하지 않는다.

### 6.2 Backend Test

```powershell
Push-Location backend
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m pip check
Pop-Location
```

### 6.3 Frontend 검증

```powershell
Push-Location frontend
npm ci
npm run typecheck
npm run build
npm run test:sites
Pop-Location
```

## 7. Test 결과

| 검증 | 결과 |
|---|---|
| Backend Unit·API Integration·Migration 회귀 Test | 24개 통과 |
| Python Dependency 일관성 | 통과 |
| Python 전체 Compile | 통과 |
| Frontend TypeScript Type Check | 통과 |
| Frontend Production Build | 통과 |
| 기존 Prototype Scenario Test | 4개 통과 |
| Frontend Dependency Audit | 취약점 0건 |
| Alembic PostgreSQL Offline SQL 생성 | 통과 |
| 실제 PostgreSQL Migration 적용 | 통과 |
| Docker Compose 계약 정적 검사 | 통과 |
| Docker Compose 전체 기동 | PostgreSQL·Backend·Caddy Healthy |
| HTTPS·로그인·Password 강제 변경·RBAC | 실제 API 및 Browser 통과 |
| Container 재생성 후 Database·내부 CA 유지 | 통과 |
| Backend 재시작 후 Session 유지 | 통과 |
| Runtime DB 계정 DDL 차단 | 통과 |
| PostgreSQL 초기화 Shell 문법 | 통과 |
| Git Whitespace 검사 | 통과 |

## 8. 미구현 항목

- Sprint 2: Patient 등록·검색, 차트번호 중복 검사, History
- Sprint 3: Scheduling Engine, 실제 월간·주간·일간 예약 저장
- Sprint 4: 이중확인, PACS 입력 확인, 장정결·약제·추가검사
- Sprint 5: 예약금, 취소, No-show, D-1
- Sprint 6: 검사 완료, 조직검사, Follow-up, Risk Dashboard, 통계
- Sprint 7: 영구 Audit Log, Backup·Restore, Windows 운영 Script
- Native Windows Service 대체 설치 자동화

## 9. 발견한 위험과 대응

| 위험 | 현재 대응 | 후속 조치 |
|---|---|---|
| 개발 PC와 실제 서버 PC의 환경 차이 | 개발 PC에서 전체 Docker E2E 통과 | 서버 후보 PC에서 같은 시험 반복 |
| Docker NAT가 Client IP를 변경 | Caddy와 Backend 양쪽 Subnet 제한 | 실제 LAN PC에서 허용·차단 시험 |
| 내부 CA 미신뢰 | Caddy 공개 Root 인증서 배포 절차 문서화 | 승인된 PC 전체의 Browser 경고 확인 |
| 계정명 추측을 이용한 반복 로그인 | 계정 잠금과 일반화된 오류 | Source IP별 영구 Rate Limit 추가 검토 |
| 권한 변경의 감사 추적 공백 | Backend에서 관리자 Permission 확인 | Sprint 7 Audit Log 구현 전 운영 금지 |
| Main PC 재부팅 후 미기동 | Docker Healthcheck 구성 | 자동 시작·Windows Update 복구 훈련 |
| Frontend 합성 데이터의 실제 데이터 오인 | README와 화면에 Prototype 표시 | Sprint 2 전 실제 환자정보 입력 금지 |

## 10. 알려진 제한사항

- 개발 PC에서는 Docker 통합시험을 완료했지만 실제 접수실 Main PC의 재부팅 후
  자동기동과 다른 원내 PC 접속은 아직 시험하지 않았다.
- 개발 PC의 Disk 암호화가 꺼져 있어 실제 환자정보 입력은 금지한다.
- 로그인 잠금은 계정 단위이며 Source IP별 영구 실패 Bucket은 없다.
- 역할 Master 생성·수정 UI는 없다. Sprint 1에서는 고정 역할을 사용자에게
  배정하는 방식이다.
- 사용자·역할 변경 Audit Log는 Sprint 7 범위다.
- TestClient 관련 Deprecation Warning 1건은 동작에 영향이 없지만 추후
  HTTP Client 전환 시 정리해야 한다.

## 11. 추가 확인이 필요한 항목

1. 실제 원내 Subnet, 고정 내부 IP, 내부 Hostname
2. 서버 후보 PC의 Docker Desktop 설치 가능 여부와 업무시간 자동기동
3. 직원 PC에 내부 CA 공개 인증서를 배포할 운영 절차
4. 30분 Idle Timeout과 12시간 Absolute Timeout의 원내 승인
5. 최초 관리자 외 추가 관리자 생성·승인 절차

위 환경값을 확정하고 실제 Container E2E 검증을 통과한 뒤 Sprint 2로 진행한다.
