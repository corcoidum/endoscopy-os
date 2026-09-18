# 당일 위내시경 전용 등록 QA

## 범위

- 합성 환자와 로컬 API fixture만 사용했다.
- `당일 위내시경` 빠른 등록, 일반 슬롯 만석 상태, 관리자 연장 슬롯 승인, 필수 확인, 저장 후 캘린더 표시를 확인했다.
- 실제 환자정보, 운영 계정, 실운영 Backend는 사용하지 않았다.

## 브라우저 검증

- 별도 `당일 위내시경` 버튼에서 등록 모달이 열렸다.
- 검사 종류는 위내시경과 30분으로 고정됐고, 대장 및 위·대장 선택은 비활성화됐다.
- 검사일은 서울 기준 오늘로 고정됐다.
- 일반 슬롯이 없을 때 관리자 승인 사유를 입력해 12:00–12:30 연장 슬롯을 개설했다.
- 당일 요청 사유, 검사 준비 확인, 의료진 시행 가능 확인, 수면검사 귀가 동행 확인 전에는 저장 가능 상태가 되지 않았다.
- 최종 확인에 `당일 연장 슬롯`과 `30분 점유`가 표시됐다.
- 저장 후 오늘 주간 캘린더에 합성 예약 1건이 재조회됐고 `당일추가`, `연장슬롯` 배지가 모두 표시됐다.
- 브라우저 콘솔 오류와 경고는 0건이었다.

증빙: `output/playwright/qa-same-day-upper.png`, `output/playwright/qa-same-day-upper-card.png`

## 자동화 검증

- Backend: `73 passed, 2 skipped` (`pytest -q`)
- Frontend unit tests: `7 passed` (`npm test`)
- Frontend typecheck: 통과 (`npm run typecheck`)
- Frontend production build: 통과 (`npm run build`), `dist/client/index.html` 생성 확인

## 검증 경계

- 브라우저 검증은 합성 API fixture 기반으로 UI와 요청/응답 연결을 확인한 것이다.
- Docker Desktop 엔진이 2분 안에 준비되지 않아 Docker Compose 기반 통합 실행은 확인하지 못했다.
- 실제 운영 DB migration, 다중 프로세스 환경의 동시성, 실사용 권한/감사 로그 조회는 배포 환경에서 별도 smoke test가 필요하다.
