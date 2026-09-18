# QA — 신규예약 복용약·생년월일 입력 (2026-09-16)

## 비교 근거

- Source visual truth: `C:\yTemp\codex-clipboard-ad62a9a9-802e-4338-b777-4223402dcdb6.png`
- Previous medication reference: `C:\yTemp\codex-clipboard-c163ab2a-38c0-4b13-af70-8c3410247fb9.png`
- Implementation: `http://127.0.0.1:4173/` Codex in-app Browser capture (this task)
- Source pixels: 1192 × 808; implementation browser viewport: 1280 × 720, device scale 1
- State: 신규 예약 Step 1 및 Step 5, 합성 환자·합성 약품만 사용

## 확인 결과

- 생년월일에 `19781105`를 직접 입력하면 `1978-11-05`로 자동 구분됩니다.
- `20260231`은 오류 문구가 표시되고 Step 5 버튼이 비활성화됩니다.
- 달력 선택 버튼과 숫자패드용 `inputMode="numeric"` 입력을 함께 제공합니다.
- 전체 복용약 메모 입력, 중단 검토 약품 2건 추가, 약품별 중단 일수 및 담당 의사 확인이 동작합니다.
- 약품 행 삭제 후 재추가가 동작하며 요약은 `중단 검토 약 2개`, `담당 의사 확인 2/2`로 갱신됩니다.
- 브라우저 console error: 0건.

## Visual QA

- Fonts and typography: 기존 Segoe UI 기반 계층과 크기를 유지했습니다.
- Spacing and layout rhythm: Step 1의 2열 기본정보 그리드와 우측 검증 패널 비율을 유지했습니다. 도움말 한 줄만 입력 하단에 추가했습니다.
- Colors and tokens: 기존 indigo focus, neutral border, red validation 토큰을 재사용했습니다.
- Image quality and assets: 이 화면에는 비교 대상 이미지 자산이 없으며 기존 Fluent icon font의 calendar 아이콘을 사용했습니다.
- Copy and content: `YYYYMMDD` 직접 입력 안내와 실제 날짜 오류 문구를 명시했습니다.
- Focused comparison: 생년월일 입력 영역과 Step 5 약품 반복 행을 확대 확인했으며 입력값·상태 요약이 모두 식별 가능합니다.

## 비교 이력

- 초기 문제: native date input의 분절 필드가 숫자패드 연속 입력을 안정적으로 구분하지 못함.
- 수정: text/numeric 입력에 8자리 자동 포맷을 적용하고 별도 calendar picker 버튼을 유지함.
- 후속 증거: 유효값 자동 변환, 존재하지 않는 날짜 차단, Step 5 활성화 조건을 실제 브라우저에서 확인함.
- 초기 문제: 약제 중단 결정이 한 약품만 지원함.
- 수정: 전체 복용약 메모와 반복 가능한 약품 행, 행별 의사 확인을 추가함.
- 후속 증거: 2개 행 추가·입력·확인·삭제·재추가 및 상태 요약 갱신을 실제 브라우저에서 확인함.

## 잔여 범위

- 현재 데이터는 React 메모리의 합성 Prototype에 저장됩니다. Backend 영속 저장과 감사로그는 별도 구현 범위입니다.
- native calendar popup 자체는 운영체제/브라우저 UI이므로 캡처 비교 대상에서 제외했습니다.

final result: passed
