import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, apiRequest } from "../src/api.ts";
import {
  appointmentsApi,
  bookingCreateErrorMessage,
  mapAppointmentResponse,
  proceduresFromDraft,
} from "../src/appointmentsApi.ts";

const draft = {
  name: "합성가람",
  chartNumber: "SYN-PT-0001",
  dateOfBirth: "1978-04-12",
  sex: "여",
  careCategory: "검진",
  procedure: "위·대장",
  procedureSet: "세트90",
  upperSedation: true,
  colonSedation: false,
  date: "2026-09-18",
  start: "09:00",
  bucket: "STANDARD_MORNING",
  bookingOrigin: "ADVANCE",
  sameDayReason: "",
  sameDayPreparationConfirmed: false,
  sameDayClinicianConfirmed: false,
  sameDayEscortConfirmed: false,
  screeningCopay: "없음",
  bowelPreparation: "원프렙",
  medicationsChecked: false,
  medicationListMemo: "",
  medicationDiscontinuations: [],
  additionalExaminations: [],
  depositStatus: "UNPAID",
  depositPaymentMethod: "미확인",
  additionalPrepayment: false,
  exceptionReason: "",
  exceptionConfirmedBy: "",
  exceptionMemo: "",
} as const;

test("예약 Draft를 Backend 검사 코드와 수면 구분으로 변환한다", () => {
  assert.deepEqual(proceduresFromDraft(draft), [
    { procedure_code: "UPPER", sedation_mode: "SEDATED" },
    { procedure_code: "COLON", sedation_mode: "NON_SEDATED" },
  ]);
});

test("Backend 예약은 주간 화면 모델로 변환하되 정적 상세 경계를 표시한다", () => {
  const appointment = mapAppointmentResponse({
    id: "00000000-0000-0000-0000-000000000001",
    patient_id: "00000000-0000-0000-0000-000000000002",
    patient_name: "합성가람",
    chart_number: "SYN-PT-0001",
    birth_date: "1978-04-12",
    sex: "FEMALE",
    service_date: "2026-09-18",
    start_time: "09:00:00",
    duration_minutes: 90,
    procedure_set: "SET_90",
    care_type: "SCREENING",
    booking_bucket: "STANDARD_MORNING",
    booking_origin: "ADVANCE",
    additional_slot_id: null,
    same_day_reason: null,
    same_day_preparation_confirmed: false,
    same_day_clinician_confirmed: false,
    same_day_escort_confirmed: false,
    same_day_confirmed_at: null,
    workflow_state: "BOOKED",
    exception_reason: null,
    exception_memo: null,
    procedures: [
      { procedure_code: "UPPER", sedation_mode: "SEDATED" },
      { procedure_code: "COLON", sedation_mode: "NON_SEDATED" },
    ],
  });

  assert.equal(appointment.start, "09:00");
  assert.equal(appointment.procedure, "위·대장");
  assert.equal(appointment.procedureSet, "세트90");
  assert.equal(appointment.backendManaged, true);
  assert.match(appointment.memo ?? "", /정적 Prototype/);
});

test("예약 생성은 CSRF와 Sprint 3A payload를 전송한다", async (t) => {
  let captured: { input: string; init?: RequestInit } | null = null;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    captured = { input: String(input), init };
    return new Response(JSON.stringify({ id: "created" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });

  await appointmentsApi.create(draft, "patient-id", "csrf-token");
  assert.equal(captured?.input, "/api/appointments");
  assert.equal(new Headers(captured?.init?.headers).get("X-CSRF-Token"), "csrf-token");
  const body = JSON.parse(String(captured?.init?.body));
  assert.equal(body.patient_id, "patient-id");
  assert.equal(body.procedure_set, "SET_90");
  assert.equal(body.procedures.length, 2);
});

test("가능 슬롯 조회는 날짜·검사·세트·예약 구분을 query로 전송한다", async (t) => {
  let requestedUrl = "";
  t.mock.method(globalThis, "fetch", async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        service_date: draft.date,
        booking_bucket: draft.bucket,
        duration_minutes: 90,
        procedure_set: "SET_90",
        schedule_policy_version: "BASE-test",
        slots: [{
          start_time: "09:00:00",
          end_time: "10:30:00",
        }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const result = await appointmentsApi.availability(draft);
  const url = new URL(requestedUrl, "http://localhost");
  assert.equal(url.pathname, "/api/appointments/availability");
  assert.deepEqual(url.searchParams.getAll("procedures"), ["UPPER", "COLON"]);
  assert.equal(url.searchParams.get("procedure_set"), "SET_90");
  assert.equal(result.slots[0].start_time, "09:00:00");
});

test("가능 슬롯 조회는 이미 고른 연장 슬롯으로 목록을 좁히지 않는다", async (t) => {
  let requestedUrl = "";
  t.mock.method(globalThis, "fetch", async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        service_date: draft.date,
        booking_bucket: "SAME_DAY_EXTENSION",
        duration_minutes: 30,
        procedure_set: null,
        schedule_policy_version: "BASE-test",
        slots: [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  await appointmentsApi.availability({
    ...draft,
    procedure: "위",
    bucket: "SAME_DAY_EXTENSION",
    bookingOrigin: "SAME_DAY",
    additionalSlotId: "slot-already-selected",
  });
  const url = new URL(requestedUrl, "http://localhost");
  assert.equal(url.searchParams.get("additional_slot_id"), null);
  assert.equal(url.searchParams.get("booking_bucket"), "SAME_DAY_EXTENSION");
});

test("당일 위내시경은 안전 확인과 당일 출처를 생성 payload에 포함한다", async (t) => {
  let body: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "same-day" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });
  await appointmentsApi.create(
    {
      ...draft,
      procedure: "위",
      bookingOrigin: "SAME_DAY",
      sameDayReason: "당일 진료 후 시행 결정",
      sameDayPreparationConfirmed: true,
      sameDayClinicianConfirmed: true,
      sameDayEscortConfirmed: true,
    },
    "patient-id",
    "csrf-token",
  );
  assert.equal(body.booking_origin, "SAME_DAY");
  assert.equal(body.same_day_preparation_confirmed, true);
  assert.deepEqual(body.procedures, [
    { procedure_code: "UPPER", sedation_mode: "SEDATED" },
  ]);
});

test("409 TIME_CONFLICT 오류 코드를 UI가 구분할 수 있게 보존한다", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        code: "TIME_CONFLICT",
        message: "다른 사용자가 같은 시간에 예약을 먼저 저장했습니다.",
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    ),
  );

  await assert.rejects(
    () => apiRequest("/api/appointments"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 409 &&
      error.code === "TIME_CONFLICT",
  );
});

test("409 TIME_CONFLICT는 사용자 행동이 분명한 한국어 안내로 변환한다", () => {
  const message = bookingCreateErrorMessage(
    new ApiError(409, "Backend 원문", "TIME_CONFLICT"),
  );
  assert.equal(
    message,
    "다른 사용자가 같은 시간을 먼저 예약했습니다. 가능 시간을 다시 조회했습니다.",
  );
});
