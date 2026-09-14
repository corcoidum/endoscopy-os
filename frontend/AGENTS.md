# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable Product Decisions

- Visual direction: Option 2, **Queue-First Workbench**.
- Show sex immediately beside every displayed age: for example `검진 47 · 여` and `일반 만 52 · 남`.
- The clinic currently operates with one director and one endoscopy room. Do not expose doctor, room, or resource selectors, filters, labels, or distinctions in the prototype.
- Treat the timetable as one shared endoscopy schedule.
- Use synthetic patient data only.
- In the weekly workbench, keep only the left `오늘 우선 처리` queue and the full-height weekly schedule; do not restore the bottom selected-patient inspector.
- Open appointment details in a centered dialog immediately when a weekly appointment or priority-queue patient is selected.
- Structure appointment detail around operational decisions first (unresolved checks, exam essentials, preparation/medication, payment), with history and results as secondary views.
- Hide PACS from appointment details until its workflow is clarified; preserve underlying data for later work.
- Record general screening and colorectal cancer screening completion separately. Provide a positive-result colonoscopy memo. Missing historical values must remain unconfirmed.
- Allow deposit amounts of 10,000, 20,000, and 30,000 KRW and distinguish card from cash. Do not infer missing historical amount/payment-method values.
- A completed secondary identity verification must be correctable through a two-step flow that requires a reason and records correction time; never offer a one-click silent undo.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
