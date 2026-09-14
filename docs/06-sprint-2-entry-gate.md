# Sprint 2 진입 Gate

- 확인일: 2026-07-31
- 결과: **Sprint 2 개발 진행 가능**
- 주의: 실제 환자정보 운영 승인이 아니라 합성 데이터 기반 개발 승인이다.

## 승인된 운영 결정

| 항목 | 확정 내용 |
|---|---|
| 초기 사용자 | 관리자 1명으로 시작 |
| 향후 사용자 | 여러 직원이 사용할 때는 직원별 개별 계정 발급 |
| 금지사항 | 여러 직원이 하나의 관리자 계정을 공유하지 않음 |
| Session | 30분 미사용 만료, 최대 12시간 |
| 로그인 제한 | 5회 실패 시 15분 잠금 |
| 최초 Password | 첫 로그인 직후 변경 필수 |
| 역할 | 관리자·원무 담당자·내시경 담당자·조회 전용 권한안 승인 |

## 승인된 Sprint 2 환자정보 규칙

- 차트번호는 필수 문자열이며 앞자리 `0`을 보존한다.
- 차트번호는 중복 저장을 차단한다.
- 이름·생년월일·성별은 필수다.
- 연락처는 선택 입력이다.
- 이름+생년월일+성별이 같으면 중복 가능성을 경고하되 자동 차단하지 않는다.
- 환자정보는 물리 삭제하지 않고 비활성화한다.
- 검진 나이는 `검사연도 - 출생연도`로 계산한다.
- 일반 나이는 검사예정일 기준 만 나이로 계산한다.
- 나이는 Database에 직접 저장하지 않는다.
- 나이 옆에 성별 `남/여`를 함께 표시한다.

## Docker 실제 시험 결과

합성 계정과 시험 전용 Secret만 사용했다.

- Docker Desktop·WSL 2 Engine 기동
- Frontend·Backend Image Build
- PostgreSQL 초기화 및 Alembic Migration 적용
- PostgreSQL·FastAPI·Caddy Healthcheck
- 내부 HTTPS Frontend 응답
- Secure·HttpOnly·SameSite Strict Session Cookie
- 최초 Password 변경 전 업무 Permission 차단
- Password 변경 후 관리자 RBAC 허용
- 로그아웃 및 변경된 Password 재로그인
- 실제 Browser의 Password 강제 변경 화면
- 조회 전용 사용자의 쓰기 메뉴 차단
- LocalStorage·SessionStorage 미사용
- Container 재생성 후 Database·Migration Revision·내부 CA 유지
- Backend 재시작 후 Session 유지
- Runtime Database 계정의 DDL 실행 차단
- Backend·PostgreSQL Host Port 비공개
- Frontend Dependency Audit 취약점 0건

시험 중 발견한 다음 문제를 수정했다.

1. Alembic Console Entrypoint의 Python import 경로
2. Caddy Container의 불필요한 Root CA 자동 설치 시도
3. Vite·PostCSS 개발 도구 취약점
4. Vite 개발 서버의 전체 Network Interface Bind

시험 종료 후 합성 관리자·합성 사용자, 시험 Database, Caddy 시험 CA,
Container와 Volume을 모두 제거했다. 재사용 가능한 Build Image와 Source Code만
남겼다.

## 실제 환자정보 운영 전 남은 Gate

- 실제 접수실 Main PC에서 같은 Docker 시험 반복
- 고정 내부 IP·실제 원내 Subnet·내부 Hostname 확정
- 다른 원내 PC에서 HTTPS 접속 및 공개 Root CA 신뢰 확인
- Windows 재부팅 후 Docker와 Application 자동기동 확인
- 서버 SSD와 외장 Backup SSD 암호화 및 복구키 관리
- Sprint 7 Backup·Restore와 월간 Restore Test 완료

위 운영 Gate가 끝나기 전에는 실제 환자정보를 입력하지 않는다.
