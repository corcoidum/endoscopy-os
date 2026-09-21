import assert from "node:assert/strict";
import test from "node:test";

import {
  overrideDetail,
  overrideRequestBody,
  scheduleOverridesApi,
  type OverrideDraft,
  type ScheduleOverride,
} from "../src/scheduleOverridesApi.ts";

const draft: OverrideDraft = {
  serviceDate: "2026-10-01",
  ruleType: "CLOSED",
  startTime: "09:00",
  endTime: "10:30",
  upperCapacity: "3",
  colonCapacity: "",
  reason: "  장비 정기점검  ",
};

const approved: ScheduleOverride = {
  id: "override-1",
  service_date: "2026-10-01",
  rule_type: "OPERATING_HOURS",
  override_start_time: "09:00:00",
  override_end_time: "10:30:00",
  override_upper_capacity: null,
  override_colon_capacity: null,
  reason: "장비 정기점검",
  status: "APPROVED",
  requested_by_user_id: "user-1",
  approved_by_user_id: "user-1",
  approved_at: "2026-09-21T00:00:00Z",
  revoked_by_user_id: null,
  revoked_at: null,
  revoke_reason: null,
  superseded_by_id: null,
  created_at: "2026-09-21T00:00:00Z",
};

test("휴진 등록은 규칙 종류에 필요 없는 시간·수용량 값을 보내지 않는다", () => {
  assert.deepEqual(overrideRequestBody(draft), {
    service_date: "2026-10-01",
    rule_type: "CLOSED",
    reason: "장비 정기점검",
  });
});

test("운영시간 변경은 시작·종료만, 수용량 변경은 입력한 항목만 보낸다", () => {
  assert.deepEqual(overrideRequestBody({ ...draft, ruleType: "OPERATING_HOURS" }), {
    service_date: "2026-10-01",
    rule_type: "OPERATING_HOURS",
    reason: "장비 정기점검",
    override_start_time: "09:00",
    override_end_time: "10:30",
  });
  // 비워 둔 대장 수용량은 요일 기본값을 유지하도록 보내지 않는다.
  assert.deepEqual(overrideRequestBody({ ...draft, ruleType: "CAPACITY" }), {
    service_date: "2026-10-01",
    rule_type: "CAPACITY",
    reason: "장비 정기점검",
    override_upper_capacity: 3,
  });
});

test("규칙 값을 한 줄로 요약한다", () => {
  assert.equal(overrideDetail(approved), "09:00~10:30");
  assert.equal(
    overrideDetail({
      ...approved,
      rule_type: "CAPACITY",
      override_upper_capacity: 3,
      override_colon_capacity: 0,
    }),
    "위 3 · 대장 0",
  );
  assert.equal(overrideDetail({ ...approved, rule_type: "CLOSED" }), "");
});

test("승인·취소는 각 Endpoint로 CSRF와 함께 보낸다", async (t) => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return new Response(
        JSON.stringify({ override: approved, impacted_appointments: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  );

  await scheduleOverridesApi.approve("override-1", "csrf-token");
  await scheduleOverridesApi.revoke("override-1", "  일정 원복 ", "csrf-token");

  assert.equal(calls[0].input, "/api/schedule/overrides/override-1/approve");
  assert.equal(calls[0].init?.body, undefined);
  assert.equal(new Headers(calls[0].init?.headers).get("X-CSRF-Token"), "csrf-token");
  assert.equal(calls[1].input, "/api/schedule/overrides/override-1/revoke");
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { reason: "일정 원복" });
});
