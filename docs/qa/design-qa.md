# Design QA — Weekly Workbench and Centered Appointment Detail

## Evidence

- Source visual truth:
  - `C:\yTemp\codex-clipboard-220b842b-9dfe-45a3-8e9d-b2ba00e54803.png` (1643×861): existing weekly workbench and bottom inspector to remove.
  - `C:\yTemp\codex-clipboard-bd5746d5-cf5a-4538-b13e-13d241220623.png` (452×790): existing appointment-detail content reference, not a layout target.
- Browser-rendered implementation:
  - [implementation-week.png](implementation-week.png) (1634×861).
  - [implementation-detail.png](implementation-detail.png) (1634×861; centered dialog 920×720 at x=357, y=70.5).
- Combined comparison evidence:
  - [design-qa-week-comparison.png](design-qa-week-comparison.png).
  - [design-qa-detail-comparison.png](design-qa-detail-comparison.png).
- Browser: Codex in-app browser, CSS viewport 1634×861, device pixel ratio 1. A second layout check used 1180×768.
- Density normalization: weekly captures were compared at 1× density and equal 861px height. The detail source was scaled from 452×790 to 412×720 and compared beside the unscaled 920×720 implementation dialog.
- State: authenticated synthetic visual-QA fixture, weekly view; then `정다은` appointment detail with `업무 요약` selected.

## Findings

- No actionable P0, P1, or P2 findings remain.
- Weekly layout: the requested bottom inspector is absent. At 1634×861 the workbench and schedule are both 737px high with matching client/scroll heights; the full Monday–Saturday timetable, including the afternoon row, is visible in the available workspace.
- Responsive desktop layout: at 1180×768 the schedule measured 860×657 with matching scroll dimensions and the workbench measured 1114×657 with matching scroll dimensions. No body overflow or section collision was observed.
- Appointment detail: the former right drawer is intentionally replaced by a centered 920×720 dialog. The default information order is unresolved checks, five operational statuses, exam essentials, and preparation guidance.
- Fonts and typography: the existing Pretendard/Noto Sans KR/Malgun Gothic/Segoe UI stack and hierarchy are preserved. The dialog uses larger patient identity and section headings without introducing a conflicting display font.
- Spacing and layout rhythm: queue width and weekly grid alignment are preserved. Compact appointment cards combine procedure and demographic information on one row so the full-height schedule does not clip status marks.
- Colors and tokens: existing indigo, blue, violet, green, orange, red, border, and surface tokens are reused. Pending and complete states retain their existing semantic colors.
- Image quality and asset fidelity: the referenced product screens contain no photographic or illustrative assets. Existing Segoe Fluent Icons are reused consistently; no placeholder imagery, custom SVG, CSS art, or generated assets were introduced.
- Copy and content: static copy now prioritizes operational decisions. `이력·결과` explicitly states the current prototype boundary instead of implying that result integrations exist.
- Accessibility and behavior: appointment cards and priority-queue cards both open the centered dialog. Detail tabs update their pressed state, initial focus moves to Close, Escape closes the dialog, and focus returns to the originating appointment. Keyboard focus is trapped within the open dialog. Browser console warnings/errors: none.

## Comparison History

- Pass 1: no P0/P1/P2 mismatch was found after implementation. The requested structural differences from the source—removing the bottom inspector, expanding the weekly schedule, and replacing the right drawer with a centered detail dialog—were verified as intentional changes.

## Primary Interactions Tested

1. Click a weekly appointment card → centered detail dialog opens for that patient.
2. Click a `오늘 우선 처리` patient → the same centered detail dialog opens.
3. Select `준비·약제` → selected tab and content change correctly.
4. Press Escape → dialog closes and keyboard focus returns to the appointment card.
5. Resize to the supported minimum desktop viewport 1180×768 → no body or workbench overflow.

## Follow-up Polish

- P3: finalize which longitudinal records belong under `이력·결과` after the real appointment/result integration boundary is decided.

## Follow-up verification — Screening and deposit records

- PACS is absent from the appointment-detail summary, tabs, and payment view; its underlying field remains untouched for future workflow design.
- `환자·검사` accepts general-screening completion, colorectal-screening completion/result, and conditionally requires a colonoscopy memo for a positive result.
- `결제` accepts 10,000/20,000/30,000 KRW, paid/unpaid state, and card/cash method; a completed payment requires both amount and method.
- Browser interaction check saved synthetic positive-result memo and a 30,000 KRW card payment successfully. Console warnings/errors: none.
- Typecheck, production build, and four Sites packaging tests passed; Docker preview was rebuilt successfully.

final result: passed
