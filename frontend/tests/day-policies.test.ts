import assert from "node:assert/strict";
import test from "node:test";

import {
  dayPolicyLookup,
  dayPolicyQueries,
  fallbackDayPolicy,
  MAX_DAY_POLICY_RANGE_DAYS,
  type DayPolicy,
} from "../src/dayPolicies.ts";
import type { BookingDraft } from "../src/scheduler.ts";
import {
  hasShortenedMorning,
  morningHoursLabel,
  standardStartsFor,
  validateSchedule,
} from "../src/scheduler.ts";

// 2026-09-18은 금요일이라 요일 기본 규칙으로는 09:00~12:00 진료일이다.
const WEEKDAY = "2026-09-18";

const draft: BookingDraft = {
  name: "합성가람",
  chartNumber: "SYN-PT-0001",
  dateOfBirth: "1978-04-12",
  sex: "여",
  careCategory: "검진",
  procedure: "위",
  procedureSet: "세트60",
  upperSedation: false,
  colonSedation: false,
  date: WEEKDAY,
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
  medicationNone: false,
  medicationCategories: { anticoagulant: false, antiplatelet: false, circulation: false, cardiac: false, neurologic: false, chronic_disease: false },
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

function policy(overrides: Partial<DayPolicy>): DayPolicy {
  return { ...fallbackDayPolicy(WEEKDAY), ...overrides };
}

test("요일 기본 규칙은 일요일 휴진과 수·토 단축 운영을 반영한다", () => {
  assert.equal(fallbackDayPolicy("2026-09-20").closed, true); // 일요일
  assert.equal(morningHoursLabel(fallbackDayPolicy("2026-09-16")), "09:00~11:00"); // 수요일
  assert.equal(morningHoursLabel(fallbackDayPolicy(WEEKDAY)), "09:00~12:00");
  assert.equal(fallbackDayPolicy(WEEKDAY).upperCapacity, 5);
  assert.equal(fallbackDayPolicy(WEEKDAY).colonCapacity, 3);
});

test("Backend에서 받은 날짜별 규칙이 요일 기본값을 이긴다", () => {
  const closedFriday = policy({ closed: true, schedulePolicyVersion: "BASE+C1" });
  const lookup = dayPolicyLookup(new Map([[WEEKDAY, closedFriday]]));

  assert.equal(lookup(WEEKDAY).closed, true);
  // 받지 못한 날짜는 요일 기본값으로 떨어진다.
  assert.equal(lookup("2026-09-17").closed, false);
});

test("휴진으로 지정된 평일은 예약 검증에서 막힌다", () => {
  const before = validateSchedule(draft, [], fallbackDayPolicy(WEEKDAY));
  assert.equal(before.valid, true);

  const after = validateSchedule(draft, [], policy({ closed: true }));
  assert.equal(after.valid, false);
  assert.ok(
    after.errors.some((message) => message.includes("휴진일로 지정")),
    after.errors.join(" / "),
  );
});

test("운영시간 변경이 선택 가능한 시작시각과 표기에 반영된다", () => {
  const shortened = policy({ morningEndMinute: 10 * 60 + 30 });

  assert.deepEqual(standardStartsFor(shortened), ["09:00", "09:30", "10:00"]);
  assert.equal(morningHoursLabel(shortened), "09:00~10:30");
  assert.equal(hasShortenedMorning(shortened), true);
  assert.equal(hasShortenedMorning(fallbackDayPolicy(WEEKDAY)), false);

  const tooLate = validateSchedule({ ...draft, start: "10:30" }, [], shortened);
  assert.equal(tooLate.valid, false);
  assert.ok(
    tooLate.errors.some((message) => message.includes("10:30")),
    tooLate.errors.join(" / "),
  );
});

test("수용량 변경이 초과 판정 기준이 된다", () => {
  const noUpper = policy({ upperCapacity: 0 });
  const result = validateSchedule(draft, [], noUpper);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((message) => message.includes("수용량 0건")),
    result.errors.join(" / "),
  );
});

test("오후 예외는 허용된 날짜에서만 통과한다", () => {
  const afternoonDraft: BookingDraft = {
    ...draft,
    bucket: "AFTERNOON_EXCEPTION",
    start: "14:00",
  };

  const notAllowed = validateSchedule(afternoonDraft, [], fallbackDayPolicy(WEEKDAY));
  assert.equal(notAllowed.valid, false);
  assert.ok(
    notAllowed.errors.some((message) => message.includes("오후 예외가 허용되지")),
    notAllowed.errors.join(" / "),
  );

  const allowed = validateSchedule(
    afternoonDraft,
    [],
    policy({ afternoonAllowed: true }),
  );
  assert.equal(allowed.valid, true, allowed.errors.join(" / "));
});

test("날짜별 규칙 조회는 Backend 기간 한도 안에서 나눠 요청한다", () => {
  const queries = dayPolicyQueries("2026-09-01", "2026-12-31");
  const days = (from: string, to: string) =>
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;

  assert.ok(queries.length > 1);
  assert.equal(queries[0].startDate, "2026-09-01");
  assert.equal(queries[queries.length - 1].endDate, "2026-12-31");
  for (const query of queries) {
    assert.ok(
      days(query.startDate, query.endDate) <= MAX_DAY_POLICY_RANGE_DAYS,
      `${query.startDate}~${query.endDate}가 한도를 넘습니다`,
    );
  }
  for (let index = 1; index < queries.length; index += 1) {
    assert.equal(days(queries[index - 1].endDate, queries[index].startDate), 1);
  }
});
