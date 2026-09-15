# Design QA — 검사 세트와 달력 탐색 개선

## 검증 기준

- Source of truth
  - `C:\yTemp\codex-clipboard-386b53ba-f817-4ce6-abfb-7fe27ad60617.png` (월간뷰)
  - `C:\yTemp\codex-clipboard-2f320476-0518-43e4-a5f7-a0d957b9883a.png` (주간뷰)
  - `C:\yTemp\codex-clipboard-eaf20318-1f5c-4793-ab6d-beffcff4b31b.png` (일간뷰)
- Implementation capture
  - `output/playwright/qa-week.png` (1643×945, synthetic authenticated fixture)
- Runtime checked
  - `http://127.0.0.1:4173`

## Phase 1 — Source inspection

- 기존 좌측 내비게이션, 상단 command bar, 푸른색 강조, 카드형 일정표의 시각 언어를 유지한다.
- 월간뷰는 월 단위, 주간뷰는 주 단위, 일간뷰는 일 단위 이전/다음 탐색이 상단에 있어야 한다.
- 일간뷰는 대상자를 시간순으로 유지하면서 일반검진 및 초음파 종류를 같은 행에서 식별할 수 있어야 한다.
- 위·대장 결합검사는 담당자 이름 대신 `세트60`/`세트90`을 선택하고 점유시간이 각각 60/90분으로 계산되어야 한다.

## Phase 2 — Implementation comparison

- 주간 구현 캡처는 기준 이미지와 동일한 정보 계층(상단 탐색 → 업무 Queue → 시간축 → 일별 카드)을 유지한다.
- 결합검사 카드에는 `세트60`/`세트90` 표지가 추가되어 실제 점유시간을 바로 구분할 수 있다.
- 월간뷰에서 다음 달과 오늘 이동, 주간뷰에서 다음 주와 이전 주 이동을 실제 브라우저에서 확인했다.
- 일간뷰에서 2026-07-30 대상자 5명이 시간순으로 표시되며, 일반검진 3명과 복부·갑상선·심장·경동맥 초음파 종류별 요약 및 행 태그를 확인했다.
- 예약 등록 2단계에서 `세트90` 선택 시 10:30–12:00, 90분으로 재계산되고, 위 단독은 30분으로 유지되는 것을 확인했다.

## Phase 3 — Interaction and polish

- [x] 월·주·일 이전/다음 탐색
- [x] 월간 날짜 클릭 후 일간뷰 전환
- [x] 주간 날짜 헤더 클릭 후 일간뷰 전환
- [x] 일간 대상자 시간순 정렬
- [x] 일반검진 및 초음파 종류별 요약/행 표시
- [x] `세트60` 60분, `세트90` 90분 계산
- [x] 위 단독 30분, 대장 단독 60분 규칙 유지
- [x] Frontend typecheck/build
- [x] Backend tests and migration execution

## Remaining findings

- P0: 없음
- P1: 없음
- P2: 없음
- 비차단 참고: 현재 프로젝트의 `frontend/package.json`에는 `test:sites` 스크립트가 없어 해당 명령은 실행할 수 없었다. 대신 typecheck, production build, backend test, Docker migration/health check, 실제 브라우저 smoke test를 수행했다.

## Final result

**passed** — 데스크톱 기준 이미지의 구조와 스타일을 보존하면서 요청된 검사 세트, 기간 탐색, 일간 요약 동작을 구현하고 검증했다.
