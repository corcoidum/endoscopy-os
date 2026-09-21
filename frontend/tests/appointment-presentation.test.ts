import assert from "node:assert/strict";
import test from "node:test";

import {
  appointmentHasStarted,
  describeHistoryChanges,
} from "../src/appointmentPresentation.ts";
import type { AppointmentHistoryEvent } from "../src/appointmentsApi.ts";

function event(overrides: Partial<AppointmentHistoryEvent>): AppointmentHistoryEvent {
  return {
    id: "event-1",
    event_type: "UPDATED",
    changed_fields: [],
    before_values: {},
    after_values: {},
    reason: "합성 사유",
    actor_user_id: "user-1",
    occurred_at: "2026-09-21T00:00:00Z",
    ...overrides,
  };
}

test("예약 변경 이력은 직원이 읽을 수 있는 전후 값으로 풀어 쓴다", () => {
  const lines = describeHistoryChanges(
    event({
      changed_fields: ["end_time", "procedures", "start_time", "patient_id"],
      before_values: {
        start_time: "09:00",
        end_time: "09:30",
        procedures: [{ procedure_code: "UPPER", sedation_mode: "NON_SEDATED" }],
      },
      after_values: {
        start_time: "10:00",
        end_time: "11:00",
        procedures: [
          { procedure_code: "COLON", sedation_mode: "SEDATED" },
          { procedure_code: "UPPER", sedation_mode: "NON_SEDATED" },
        ],
      },
    }),
  );

  assert.deepEqual(lines, [
    "종료: 09:30 → 11:00",
    "검사: 위 → 대장(수면)·위",
    "시작: 09:00 → 10:00",
  ]);
});

test("취소는 상태 변화를 한국어 값으로 보여 주고, 등록은 변경 줄이 없다", () => {
  assert.deepEqual(
    describeHistoryChanges(
      event({
        event_type: "CANCELLED",
        changed_fields: ["workflow_state"],
        before_values: { workflow_state: "BOOKED" },
        after_values: { workflow_state: "CANCELLED" },
      }),
    ),
    ["상태: 예약 → 취소"],
  );
  assert.deepEqual(
    describeHistoryChanges(
      event({ event_type: "CREATED", before_values: null, changed_fields: ["start_time"] }),
    ),
    [],
  );
});

test("No-show는 서울 기준 예약 시작시각이 지난 뒤에만 가능하다", () => {
  const appointment = { date: "2026-09-21", start: "09:00" };

  // 09:00 KST == 00:00 UTC
  assert.equal(appointmentHasStarted(appointment, new Date("2026-09-20T23:59:59Z")), false);
  assert.equal(appointmentHasStarted(appointment, new Date("2026-09-21T00:00:00Z")), true);
});
