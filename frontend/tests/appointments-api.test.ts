import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, apiRequest } from "../src/api.ts";
import {
  appointmentChangeFrom,
  appointmentsApi,
  bookingCreateErrorMessage,
  mapAppointmentResponse,
  proceduresFromDraft,
  type AppointmentResponse,
} from "../src/appointmentsApi.ts";
import type { BookingDraft } from "../src/scheduler.ts";

const draft: BookingDraft = {
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
};

test("예약 Draft를 Backend 검사 코드와 수면 구분으로 변환한다", () => {
  assert.deepEqual(proceduresFromDraft(draft), [
    { procedure_code: "UPPER", sedation_mode: "SEDATED" },
    { procedure_code: "COLON", sedation_mode: "NON_SEDATED" },
  ]);
});

const backendAppointment: AppointmentResponse = {
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
    exception_status: "NOT_APPLICABLE",
    exception_reason: null,
    exception_memo: null,
    procedures: [
      { procedure_code: "UPPER", sedation_mode: "SEDATED" },
      { procedure_code: "COLON", sedation_mode: "NON_SEDATED" },
    ],
    row_version: 3,
};

test("Backend 예약은 주간 화면 모델로 변환하되 정적 상세 경계를 표시한다", () => {
  const appointment = mapAppointmentResponse(backendAppointment);

  assert.equal(appointment.start, "09:00");
  assert.equal(appointment.rowVersion, 3);
  assert.equal(appointment.procedure, "위·대장");
  assert.equal(appointment.procedureSet, "세트90");
  assert.equal(appointment.backendManaged, true);
  assert.match(appointment.memo ?? "", /정적 Prototype/);
});

test("예약 생성은 CSRF와 Sprint 3A payload를 전송한다", async (t) => {
  let captured: { input: string; init?: RequestInit } | null = null;
  // Callback 안의 대입은 Type 좁히기가 따라오지 못하므로 함수로 읽는다.
  const capturedCall = () => captured;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { input: String(input), init };
      return new Response(JSON.stringify({ id: "created" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  await appointmentsApi.create(draft, "patient-id", "csrf-token");
  const call = capturedCall();
  assert.ok(call, "fetch가 호출되지 않았습니다");
  assert.equal(call.input, "/api/appointments");
  assert.equal(new Headers(call.init?.headers).get("X-CSRF-Token"), "csrf-token");
  const body = JSON.parse(String(call.init?.body));
  assert.equal(body.patient_id, "patient-id");
  assert.equal(body.procedure_set, "SET_90");
  assert.equal(body.procedures.length, 2);
});

test("가능 슬롯 조회는 날짜·검사·세트·예약 구분을 query로 전송한다", async (t) => {
  let requestedUrl = "";
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
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
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
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
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("예약 변경은 row_version·사유와 변경 가능한 항목만 PATCH로 보낸다", async (t) => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return jsonResponse({ ...backendAppointment, row_version: 4 });
    },
  );
  const appointment = mapAppointmentResponse(backendAppointment);
  const change = { ...appointmentChangeFrom(appointment), startTime: "10:00" };

  await appointmentsApi.change(appointment, change, "  환자 요청  ", "csrf-token");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, `/api/appointments/${backendAppointment.id}`);
  assert.equal(calls[0].init?.method, "PATCH");
  assert.equal(new Headers(calls[0].init?.headers).get("X-CSRF-Token"), "csrf-token");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.row_version, 3);
  assert.equal(body.reason, "환자 요청");
  assert.equal(body.start_time, "10:00");
  assert.equal(body.procedure_set, "SET_90");
  assert.equal(body.care_type, "SCREENING");
  // 환자 정보는 예약 변경 대상이 아니다.
  assert.equal("patient_id" in body, false);
});

test("변경용 가능 시간 조회는 자기 예약을 계산에서 빼 달라고 요청한다", async (t) => {
  let requestedUrl = "";
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return jsonResponse({
      service_date: "2026-09-18",
      booking_bucket: "STANDARD_MORNING",
      duration_minutes: 90,
      procedure_set: "SET_90",
      schedule_policy_version: "BASE-test",
      slots: [],
    });
  });
  const appointment = mapAppointmentResponse(backendAppointment);

  await appointmentsApi.changeAvailability(appointment, appointmentChangeFrom(appointment));

  const url = new URL(requestedUrl, "http://localhost");
  assert.equal(url.searchParams.get("exclude_appointment_id"), backendAppointment.id);
  assert.equal(url.searchParams.get("booking_origin"), "ADVANCE");
  assert.deepEqual(url.searchParams.getAll("procedures"), ["UPPER", "COLON"]);
});

test("취소·No-show는 각 Endpoint로 row_version과 사유를 보낸다", async (t) => {
  const calls: Array<{ input: string; body: Record<string, unknown> }> = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), body: JSON.parse(String(init?.body)) });
      return jsonResponse(backendAppointment);
    },
  );
  const appointment = mapAppointmentResponse(backendAppointment);

  await appointmentsApi.cancel(appointment, "환자 사정", "csrf-token");
  await appointmentsApi.noShow(appointment, "연락 두절", "csrf-token");

  assert.deepEqual(
    calls.map((call) => call.input),
    [
      `/api/appointments/${backendAppointment.id}/cancel`,
      `/api/appointments/${backendAppointment.id}/no-show`,
    ],
  );
  assert.deepEqual(calls[0].body, { row_version: 3, reason: "환자 사정" });
  assert.deepEqual(calls[1].body, { row_version: 3, reason: "연락 두절" });
});

test("Backend에 없는 합성 예약은 변경 요청을 보내지 않는다", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => jsonResponse({}));
  const fixture = { ...mapAppointmentResponse(backendAppointment), backendManaged: undefined };

  await assert.rejects(
    appointmentsApi.cancel(fixture, "사유", "csrf-token"),
    (error: unknown) => error instanceof ApiError && /Backend에 저장된 예약/.test(error.message),
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("409 STALE_ROW_VERSION 코드를 UI가 구분할 수 있게 보존한다", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(
      {
        code: "STALE_ROW_VERSION",
        message: "다른 사용자가 먼저 예약을 변경했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
      },
      409,
    ),
  );
  const appointment = mapAppointmentResponse(backendAppointment);

  await assert.rejects(
    appointmentsApi.cancel(appointment, "사유", "csrf-token"),
    (error: unknown) =>
      error instanceof ApiError && error.status === 409 && error.code === "STALE_ROW_VERSION",
  );
});
