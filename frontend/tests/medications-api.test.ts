import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../src/api.ts";
import { medicationQueue } from "../src/appointmentPresentation.ts";
import {
  MEDICATION_STATE_LABELS,
  checklistBody,
  emptyMedicationCategories,
  medicationCheckState,
  medicationErrorMessage,
  medicationNeedsReload,
  medicationsApi,
  solePhysician,
  wizardMedicationRequests,
  wizardMedicationTouched,
  type WizardMedicationDraft,
} from "../src/medicationsApi.ts";
import { medicationDraftErrors } from "../src/scheduler.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wizardDraft(overrides: Partial<WizardMedicationDraft> = {}): WizardMedicationDraft {
  return {
    medicationsChecked: true,
    medicationNone: false,
    medicationListMemo: "합성약 A 1정 아침",
    medicationCategories: { ...emptyMedicationCategories(), antiplatelet: true },
    medicationDiscontinuations: [
      { medicationName: " 합성 항혈소판제 ", discontinuationDays: "7", doctorConfirmed: true },
      { medicationName: "", discontinuationDays: "", doctorConfirmed: false },
    ],
    ...overrides,
  };
}

test("복용약 확인 저장은 화면이 본 row_version과 CSRF를 함께 보내고, 없음이면 분류를 비운다", async (t) => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    return jsonResponse({});
  });

  const none = checklistBody({
    status: "NONE_CONFIRMED",
    medicationList: "  ",
    categories: { ...emptyMedicationCategories(), anticoagulant: true },
    surgeryHistory: "",
    cardiovascularHistory: " 합성 스텐트 ",
    emrRecorded: true,
  });
  await medicationsApi.saveChecklist("apt-1", none, 3, "csrf");

  assert.equal(calls[0].input, "/api/appointments/apt-1/medication-review/checklist");
  assert.equal(calls[0].init?.method, "PUT");
  assert.equal(new Headers(calls[0].init?.headers).get("X-CSRF-Token"), "csrf");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    medication_status: "NONE_CONFIRMED",
    categories: emptyMedicationCategories(),
    cardiovascular_history: "합성 스텐트",
    emr_recorded: true,
    expected_row_version: 3,
  });
});

test("약별 결정·안내·실제 중단 확인·철회는 기대 Revision을 함께 보낸다", async (t) => {
  const bodies: Array<{ input: string; body: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push({ input: String(input), body: JSON.parse(String(init?.body)) });
    return jsonResponse({});
  });
  const item = { item_key: "key-1", revision: 2 };
  const decision = {
    decision: "HOLD" as const,
    hold_days: 5,
    physician_profile_id: "doc-1",
    physician_confirmed: true,
  };

  await medicationsApi.addItem("apt-1", "  합성약  ", decision, "csrf");
  await medicationsApi.decide("apt-1", item, decision, "csrf");
  await medicationsApi.notify("apt-1", item, "csrf");
  await medicationsApi.confirmHold("apt-1", item, "2026-09-23", "csrf");
  await medicationsApi.withdraw("apt-1", item, "  오기입  ", "csrf");

  assert.deepEqual(bodies[0], {
    input: "/api/appointments/apt-1/medication-review/items",
    body: { medication_name: "합성약", decision },
  });
  assert.deepEqual(bodies[1].body, { ...decision, expected_revision: 2 });
  assert.equal(bodies[1].input, "/api/appointments/apt-1/medication-review/items/key-1/decision");
  assert.deepEqual(bodies[2].body, { expected_revision: 2 });
  assert.deepEqual(bodies[3].body, { expected_revision: 2, confirmed_on: "2026-09-23" });
  assert.deepEqual(bodies[4].body, { expected_revision: 2, reason: "오기입" });
});

test("예약 등록 5단계 입력은 의사가 확인한 중단 결정만 결정 의사와 함께 보낸다", () => {
  const requests = wizardMedicationRequests(wizardDraft(), "doc-1");
  assert.equal(requests.checklist.medication_status, "LIST_CONFIRMED");
  assert.equal(requests.checklist.medication_list, "합성약 A 1정 아침");
  assert.equal(requests.checklist.categories.antiplatelet, true);
  // 빈 행은 보내지 않는다.
  assert.deepEqual(requests.items, [
    {
      medication_name: "합성 항혈소판제",
      decision: {
        decision: "HOLD",
        hold_days: 7,
        rationale: undefined,
        physician_profile_id: "doc-1",
        physician_confirmed: true,
      },
    },
  ]);

  const none = wizardMedicationRequests(
    wizardDraft({ medicationNone: true, medicationListMemo: "" }),
    null,
  );
  assert.equal(none.checklist.medication_status, "NONE_CONFIRMED");
  assert.deepEqual(none.checklist.categories, emptyMedicationCategories());
  assert.deepEqual(none.items, []);

  assert.throws(() => wizardMedicationRequests(wizardDraft(), null), /의사 Profile/);
  assert.equal(
    wizardMedicationTouched({
      ...wizardDraft({ medicationsChecked: false, medicationListMemo: "" }),
      medicationCategories: emptyMedicationCategories(),
      medicationDiscontinuations: [{ medicationName: "", discontinuationDays: "", doctorConfirmed: false }],
    }),
    false,
  );
});

test("예약 등록 복용약 검사: 1~90일, 의사 확인, 없음 확인, 목록 기록을 요구한다", () => {
  const base = {
    ...wizardDraft(),
    medicationDiscontinuations: [
      { id: "m1", medicationName: "합성약", discontinuationDays: "7", doctorConfirmed: true },
    ],
  };
  assert.deepEqual(medicationDraftErrors(base), []);
  for (const days of ["0", "91", "2.5"]) {
    const errors = medicationDraftErrors({
      ...base,
      medicationDiscontinuations: [{ ...base.medicationDiscontinuations[0], discontinuationDays: days }],
    });
    assert.match(errors.join(), /1~90/);
  }
  assert.match(
    medicationDraftErrors({
      ...base,
      medicationDiscontinuations: [{ ...base.medicationDiscontinuations[0], doctorConfirmed: false }],
    }).join(),
    /담당 의사의 확인/,
  );
  assert.match(medicationDraftErrors({ ...base, medicationListMemo: " " }).join(), /전체 복용약 목록/);
  assert.match(medicationDraftErrors({ ...base, medicationNone: true }).join(), /중단 검토 약을 비워/);
});

test("원장 1인 운영이라 활성 의사 Profile이 정확히 한 명일 때만 결정 의사로 쓴다", () => {
  assert.equal(solePhysician([{ id: "doc-1", display_name: "합성 원장" }]).physician?.id, "doc-1");
  assert.match(solePhysician([]).problem ?? "", /등록/);
  assert.match(
    solePhysician([
      { id: "doc-1", display_name: "합성 원장" },
      { id: "doc-2", display_name: "합성 의사" },
    ]).problem ?? "",
    /한 명만/,
  );
});

test("약제 상태 표시는 검사 준비 완료처럼 보이지 않고 주간 카드는 세 단계로 줄인다", () => {
  for (const label of Object.values(MEDICATION_STATE_LABELS)) {
    assert.doesNotMatch(label, /준비/);
  }
  assert.equal(medicationCheckState("NOT_REQUIRED"), "불필요");
  assert.equal(medicationCheckState(undefined), "불필요");
  assert.equal(medicationCheckState("COMPLETE"), "완료");
  assert.equal(medicationCheckState("PHYSICIAN_REQUIRED"), "대기");
});

test("약제 확인 대기 목록은 재검토·의사 확인·확인 필요·안내 순으로 늘어놓는다", () => {
  const queue = medicationQueue([
    { date: "2026-09-24", start: "09:00", medicationState: "NOTIFICATION_REQUIRED" as const },
    { date: "2026-09-24", start: "10:00", medicationState: "COMPLETE" as const },
    { date: "2026-09-25", start: "09:00", medicationState: "CHECK_REQUIRED" as const },
    { date: "2026-09-26", start: "09:00", medicationState: "RE_REVIEW_REQUIRED" as const },
    { date: "2026-09-23", start: "11:00", medicationState: "PHYSICIAN_REQUIRED" as const },
    { date: "2026-09-23", start: "09:00", medicationState: "NOT_REQUIRED" as const },
  ]);
  assert.deepEqual(
    queue.map((item) => `${item.medicationState} ${item.date}`),
    [
      "RE_REVIEW_REQUIRED 2026-09-26",
      "PHYSICIAN_REQUIRED 2026-09-23",
      "CHECK_REQUIRED 2026-09-25",
      "NOTIFICATION_REQUIRED 2026-09-24",
    ],
  );
});

test("낡은 화면 충돌은 다시 불러오고, 권한 부족은 한국어로 안내한다", () => {
  assert.equal(medicationNeedsReload(new ApiError(409, "", "MEDICATION_ITEM_STALE")), true);
  assert.equal(medicationNeedsReload(new ApiError(409, "", "MEDICATION_RE_REVIEW_REQUIRED")), true);
  assert.equal(medicationNeedsReload(new ApiError(422, "", "PHYSICIAN_CONFIRMATION_INVALID")), false);
  assert.match(medicationErrorMessage(new ApiError(403, "x", "PERMISSION_DENIED")), /권한이 없습니다/);
  assert.equal(
    medicationErrorMessage(new ApiError(409, "검사일이 바뀌어 의사 재검토가 필요합니다.", "MEDICATION_RE_REVIEW_REQUIRED")),
    "검사일이 바뀌어 의사 재검토가 필요합니다.",
  );
});
