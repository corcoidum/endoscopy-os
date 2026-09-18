# Calendar data consistency QA — 2026-09-18

## Cause and change

- Week used Backend appointments; month/day used July static fixtures.
- Queries previously always covered Monday–Saturday, even when viewing a month.
- All three calendars now consume the same Backend data model and name/chart search filter.
- Query the selected day/week or full visible month grid. Split month grids into non-overlapping chunks of at most 31 dates to respect the Backend range limit.
- Clear previous results on a new request; ignore obsolete responses. Month/day show loading/error/retry rather than treating a failed request as an empty calendar.
- Empty month cells say `예약 없음`, not `예약 가능`: listing bookings does not establish bookability.

## Verification

- `npm test`: 13 passed, including selected-date, month-boundary, six-row grid, and leap-year range tests.
- `npm run typecheck` and `npm run build`: passed.
- Browser QA via Codex browser/Playwright locators, using the local synthetic API fixture, not an authenticated live Backend session.
- Fixture: `CALENDAR_QA=1 node frontend/tests/fixtures/visual-auth-server.mjs`; Vite proxy target `http://127.0.0.1:18080`, port 4175. Default fixture remains empty for other workflows.
- September 1–19 fixture: 45 bookings, Sundays excluded. September 14–19 week shows 3/3/2/3/3/2 patients (16 total).
- September 18: month shows 3 patients / upper 2 / colon 2; week matches; clicking month date opens day with the same three synthetic patients at 09:00, 09:30, 10:30.
- Searching `SYN-PT-0002` shows one patient on September 18 in every view, and week header counts match filtered cards.
- Clearing search and opening September 21 shows 0 patients with no stale September 18 rows.
- Inspected day screenshot: status banner and patient rows render correctly; existing narrow-viewport horizontal scroll remains.
- Docker Preview frontend artifact rebuilt and copied to the existing static volume. No database records or credentials changed by this fix.

## Boundaries

- Browser checks prove frontend behavior against synthetic HTTP responses, not live DB/auth behavior. Live authenticated browser verification and simulated error/retry remain follow-up checks.
- Priority queue, Today dashboard, preparation, payment, and additional-screening fields are still prototype data; this change connects only the three requested calendars. Do not interpret default preparation/payment states as persisted clinical facts.
