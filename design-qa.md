# Phase 3 Design QA

## 검증 대상

- 선택 시안: `C:\Users\user\.codex\generated_images\019fb0fd-491d-7951-8238-4e539d368ebe\call_JHJy953akTBKYKYAeiYlWo4J.png`
- 구현 화면: `E:\openkiki\codex_root\endoscopy-os\qa\implementation-1920x1080-final.jpg`
- 전체 비교: `E:\openkiki\codex_root\endoscopy-os\qa\design-comparison-final.jpg`
- 집중 비교: `E:\openkiki\codex_root\endoscopy-os\qa\design-comparison-focused.jpg`
- 검증 상태: 주간 화면, 2026-07-27~2026-08-01, `정다은` 예약 선택
- 기준 Viewport: 1920×1080, 1366×768
- 비교 정규화: 선택 시안 1680×944와 구현 1920×1080을 각각 1440×810으로 정규화
- Device Pixel Ratio: 1

## 요구사항 검증

| 검증 항목 | 결과 | 근거 |
|---|---|---|
| Option 2 Queue-First Workbench | 통과 | 왼쪽 우선 처리 Queue, 가운데 월~토 일정, 아래 선택 예약 Inspector 구성 |
| 나이 옆 성별 표시 | 통과 | Queue, 예약 카드, Inspector, 예약 Form, 조직검사 관리대장에서 `검진 47 · 여` 또는 `일반 만 52 · 남` 형식 사용 |
| 검진/일반 나이 계산 분리 | 통과 | 검진은 `검사연도-출생연도`, 일반은 검사일 기준 만 나이로 화면 표시값 계산 |
| 단일 원장·단일 내시경실 | 통과 | 의사, 방, Resource 선택기·필터·카드 표기를 만들지 않고 하나의 공용 일정으로 구성 |
| 수·토 11시 종료 | 통과 | 수·토 비활성 영역과 운영 종료 표시, 10:30 60분 검사 선택 시 종료시간 초과 경고 표시 |
| 오후 예외 Bucket 분리 | 통과 | 14:00 예외 행을 오전 일정과 시각·스타일·검증 규칙으로 분리 |
| 합성 데이터 전용 | 통과 | `T-` 접두 차트번호와 합성 이름만 사용하고 화면에 합성 데이터 표식 표시 |
| 조직검사 운영 결정 | 통과 | Biopsy/CLO만 표시, 씨젠 최초 게시 결과보고일만 사용, 기관+접수번호와 관리자 확인 기록 표시 |

## 시각 비교

| 표면 | 결과 | 판정 |
|---|---|---|
| Typography | 업무용 산세리프, 굵기 계층, 작은 Badge의 정보 밀도가 시안과 일치 | 통과 |
| Spacing / Layout | Navigation–Queue–주간 보드–Inspector 순서와 Dense 레이아웃 유지 | 통과 |
| Colors | Indigo 선택색과 Slate 기반, Green/Orange/Red 의미색 체계 유지 | 통과 |
| Images / Assets | 환자 이미지를 사용하지 않으며 단일 시스템 아이콘 계열 사용 | 통과 |
| Copy | 한국어 의원 업무용어, 합성 데이터 경고, 명시적 오류·대안 문구 적용 | 통과 |
| Icons | 상태를 색상만으로 구분하지 않고 Icon·Text·Badge를 함께 제공 | 통과 |

## 상호작용 검증

- 새 예약 8단계 Modal 열기와 Step 이동
- 수·토 10:30 위·대장 선택 시 운영시간 초과 및 14:00 대안 표시
- 14:00 예외 선택 시 사유·확인자·메모 미입력 저장 차단
- 예외 필수값 입력 후 예약 가능 판정
- 예약 카드 선택과 하단 Inspector 갱신
- 예약 변경 시 핵심정보 확인 상태 무효화 안내
- 조직검사 Case 선택, 결과보고일·기관·접수번호 확인, 환자 통보 완료 처리
- Keyboard: `N`, `E`, `F2`, `F4`, `F6`, `/`, `Ctrl+K`, `Enter`, `Escape`
- 1366×768에서 문서 가로·세로 Overflow 없음
- Browser Console Error: 없음

## 수정 이력

1. 1차 비교에서 주간 Slot과 Queue Card가 시안보다 낮아 작업영역 아래 여백이 크게 보이는 P2 차이를 확인했습니다. Slot 높이, Queue Card 높이, 핵심 Typography를 조정했습니다.
2. 2차 비교에서 수·토 10:30의 60분 검사 불가 사례가 주간 화면에 즉시 보이지 않는 P2 차이를 확인했습니다. 토요일 검증 예시 Card와 종료시간 초과·대체시간 문구를 추가했습니다.
3. 최종 비교에서 P0, P1, P2 차이는 없습니다. Queue 폭과 일부 보조 문자의 상대 크기는 시안과 소폭 다른 P3 차이지만, 1366×768 지원과 실제 업무 밀도를 위한 의도된 조정입니다.

## 자동 검증

- `npm run build`: 통과
- `npm run test:sites`: 4개 통과, 실패 0개

final result: passed
