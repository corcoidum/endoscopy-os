# Repository Instructions

원내 내시경 예약·검사 운영 시스템(FastAPI·PostgreSQL·React)이다. 이 저장소에서 작업하는
사람과 도구는 아래 규칙을 따른다. 화면 규칙은 [frontend/AGENTS.md](./frontend/AGENTS.md)를 함께 본다.

## 먼저 읽을 것

- [README](./README.md): 현재 구현 범위, 로드맵, API
- [docs/14-macos-development-guide.md](./docs/14-macos-development-guide.md): 지금 상태, 명령,
  다음 작업, 결정 대기 항목
- 최근 Sprint 보고서(`docs/1x-sprint-*-report.md`)와 PRD·아키텍처 문서(`docs/02`, `docs/03`)

## 데이터와 안전

- 합성 환자·합성 직원 계정만 쓴다. 실제 환자정보를 Test·Seed·QA 캡처·문서·예시에 넣지 않는다.
- PostgreSQL 전용 Test는 대상 Schema를 지우므로 `scripts/pg-test.sh`가 만드는 일회용 Container에만
  연결한다.
- Git push, 외부 배포, 운영 Database 변경은 요청받았을 때만 한다.
- 운영 비밀값(`.env`)을 만들거나 옮기지 않는다. 로컬 확인은 `scripts/dev.sh`의 합성 설정을 쓴다.

## 작업 방식

- 기존 FastAPI·PostgreSQL·React 구조와 디자인을 유지한다. 불필요한 의존성 추가와 대규모
  Refactoring을 하지 않는다.
- 변경 뒤 `scripts/verify.sh`(Windows는 `scripts/verify.ps1`도 가능)를 통과시킨다. 상태를 바꾸는
  화면 흐름은 `scripts/e2e.sh`, Migration·동시성은 `scripts/pg-test.sh`로 확인한다.
- 화면 작업은 로컬 서버를 직접 띄워 Browser로 확인하고, QA 기록은
  `docs/qa/YYYY-MM-DD-<topic>.md`로 남긴다.
- Sprint가 끝나면 Sprint 보고서와 README를 갱신하고 완료 기능, 실행한 검사, 실행하지 않은 검사와
  이유, 남은 제한, 실행 환경 문제와 제품 결함을 나눠 쓴다.
- 문서와 사용자 안내 문구는 한국어로 쓴다. 코드 주석은 주변 코드처럼 짧은 한국어로 쓴다.
