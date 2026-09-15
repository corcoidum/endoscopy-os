# Design QA — 기간별·수면별 운영 통계

> 참고: 이 문서가 가리키는 `output/playwright/*.png` 캡처는 `.gitignore` 대상이라 레포에 포함되어 있지 않습니다.

## Comparison target

- Source visual truth: `C:\yTemp\codex-clipboard-ba029a00-43b5-4a48-9423-53e56efe091f.png`
- Implementation screenshot: `output/playwright/qa-statistics-week.png`
- Local runtime: `http://127.0.0.1:4173`
- State: 통계 메뉴, 2026-07-27~2026-08-01 주간 집계

## Normalization

- Source pixels: 1165 × 721
- Implementation pixels: 1165 × 721
- CSS viewport: 1165 × 721
- Device scale factor: 1
- Density normalization: 동일한 픽셀 크기와 밀도로 별도 보정 없음

## Full-view comparison evidence

- 기준 화면의 좌측 rail, 상단 command bar, 제목 영역, 3개 통계 카드 구조와 indigo/violet 강조색을 유지했다.
- 기간 탭을 제목 우측에 배치해 기존 정보 계층을 해치지 않고 `주간·월간·연간`을 전환할 수 있다.
- 기존 3개 요약 카드 아래에 위·대장 수면 통계를 같은 카드 언어로 추가했다.
- 1165×721에서 탭, 세 요약 카드, 두 수면 통계 카드가 모두 잘림 없이 첫 화면에 표시된다.

## Focused region comparison evidence

- 기간 탭과 상단 날짜 표시를 확인했다. 주간은 이전/다음 주, 월간은 이전/다음 달, 연간은 이전/다음 연도로 동작한다.
- 기준 주간 데이터는 환자 25명, 위 22건, 대장 8건이다. 추가 집계는 위 수면 19·비수면 3, 대장 수면 0·비수면 8로 표시된다.
- 월간 2026년 7월은 환자 23명, 다음 달 8월은 2명으로 변경되어 기간 필터가 전체 배열 집계와 분리됨을 확인했다.
- 위·대장 동시 예약은 환자 1명, 위 1건, 대장 1건으로 계산되고 각각의 수면 선택값을 사용한다.

## Required fidelity surfaces

- Fonts and typography: 기존 system font, 제목·eyebrow·숫자 계층과 굵기를 유지했다.
- Spacing and layout rhythm: 기준의 3열 카드 폭과 gap을 유지하고 하단 상세 카드는 2열로 정렬했다.
- Colors and visual tokens: 기존 blue, indigo, violet, neutral surface token만 사용했다.
- Image quality and asset fidelity: 별도 래스터 이미지가 없는 정보 UI이며 기존 Fluent icon component만 사용했다.
- Copy and content: `전체 실제 검사 건수` 대신 Prototype의 실제 근거에 맞는 `기간 내 전체 예약`과 `예약 기준`을 명시했다.

## Interaction verification

- [x] 주간·월간·연간 탭 전환
- [x] 기간별 상단 label 동기화
- [x] 이전/다음 주·월·연도 이동
- [x] 오늘 버튼으로 기준일 복귀
- [x] 일반 예약·오후 예외·전체 예약 기간 필터
- [x] 위·대장별 수면·비수면 건수와 비율
- [x] Browser console warning/error 없음

## Findings and comparison history

- 첫 비교 P2: 예약 기반 카드에 `TOTAL ACTUAL` 문구가 남아 실제 시행 통계로 오해될 수 있었다.
- 수정: eyebrow를 `PERIOD TOTAL`로 변경하고 카드 제목을 `기간 내 전체 예약`으로 유지했다.
- 수정 후 증거: `output/playwright/qa-statistics-week.png`에서 예약 데이터 기준이 상·하단에 일관되게 표시된다.
- P0: 없음
- P1: 없음
- P2: 없음
- P3: 실제 시행 결과 Entity가 연결되면 예약 통계와 실제 완료 통계를 별도 탭으로 확장할 수 있다.

## Implementation checklist

- [x] 기간 필터 helper와 날짜 이동 연결
- [x] 주간·월간·연간 tab state
- [x] 위·대장 수면 여부 집계
- [x] 1050px 이하 단일열 responsive fallback
- [x] 예약 기반 통계임을 명시

final result: passed
