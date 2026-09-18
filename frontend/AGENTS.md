# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable Product Decisions

- Visual direction: Option 2, **Queue-First Workbench**.
- Show sex immediately beside every displayed age: for example `검진 47 · 여` and `일반 만 52 · 남`.
- The clinic currently operates with one director and one endoscopy room. Do not expose doctor, room, or resource selectors, filters, labels, or distinctions in the prototype.
- For combined upper-and-colon appointments, label the operational assignee as `세트60` or `세트90` rather than a person's name. `세트60` occupies 60 minutes and `세트90` occupies 90 minutes; upper-only remains 30 minutes and colon-only remains 60 minutes.
- Month, week, and day views must navigate by their own period. The day view keeps patients in time order and shows general-screening and ultrasound types in both the daily summary and each patient row.
- Statistics must switch among week, month, and year periods and report upper/colon totals with separate sedation and non-sedation counts. Statistics shown from prototype appointments are reservation-based, not proof of actual procedure completion.
- Treat the timetable as one shared endoscopy schedule.
- Month, week, and day calendars must use the same Backend appointments, never mix static fixtures with saved bookings. Query the full visible period (including adjacent-month cells), respect API range limits, and distinguish loading/errors from an empty day.
- Use synthetic patient data only.
- A new booking must start with blank patient identity fields and no selected sex. Do not preload a synthetic patient or a paid deposit; keep existing values only when editing an appointment.
- Patient birth date entry must support both a calendar picker and direct numeric keypad entry. Eight digits (`YYYYMMDD`) are automatically formatted as `YYYY-MM-DD`, and invalid calendar dates must not unlock later booking steps.
- In booking step 5, record the full medication list as a free-text memo and support repeatable medication-discontinuation rows. Each entered row requires its own medication name, physician-decided stop duration, and explicit physician confirmation; the system must not recommend discontinuation.
- In the weekly workbench, keep only the left `오늘 우선 처리` queue and the full-height weekly schedule; do not restore the bottom selected-patient inspector.
- Open appointment details in a centered dialog immediately when a weekly appointment, day-view patient row, or priority-queue patient is selected.
- Structure appointment detail around operational decisions first (unresolved checks, exam essentials, preparation/medication, payment), with history and results as secondary views.
- In booking step 2, pick the exam date from an availability month calendar (not a bare date input). Each day shows how many start times are bookable for the selected procedure, set, and booking bucket, plus closed/short-morning/full states and the next available dates. Slot availability reflects schedule rules only; form errors (identity, medication, exception reason) are enforced at save.
- Hide PACS from appointment details until its workflow is clarified; preserve underlying data for later work.
- Record general screening and colorectal cancer screening completion separately. Provide a positive-result colonoscopy memo. Missing historical values must remain unconfirmed.
- Allow deposit amounts of 10,000, 20,000, and 30,000 KRW and distinguish card from cash. Do not infer missing historical amount/payment-method values.
- A completed secondary identity verification must be correctable through a two-step flow that requires a reason and records correction time; never offer a one-click silent undo.
- Same-day add-on booking supports upper endoscopy only and always occupies 30 minutes. Use a normal vacant slot first; when none remains, require one explicitly approved 30-minute extension slot. Never allow overlaps, require preparation and clinician confirmation, and require an escort confirmation for sedated procedures.
- New bookings must explicitly choose either `납부 완료` or `미납으로 예약`; do not treat an untouched payment checkbox as confirmed unpaid. A paid deposit still requires amount and card/cash method. Deposit fields remain React-memory prototype data until a Backend contract is added.

Build app UI in `src/`. The app is deployed only inside the clinic network through Docker Compose and Caddy; do not add external hosting (Sites/Workers) artifacts. `npm run build` must leave `dist/client/index.html`, which `frontend/Dockerfile` copies into the Caddy static volume.

Record each Design QA pass as a new file `docs/qa/YYYY-MM-DD-<topic>.md`. Do not create or overwrite a root-level `design-qa.md`, and never include real patient data in QA captures or notes.
