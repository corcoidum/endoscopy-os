import assert from "node:assert/strict";
import test from "node:test";
import { MAX_QUERY_RANGE_DAYS, calendarQueries } from "../src/calendarQueries.ts";

type CalendarQuery = { startDate: string; endDate: string };

const DAY_MS = 86400000;

function days(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
}

/** 각 chunk가 API 한도 안이고, chunk 사이에 빈 날짜나 겹침이 없는지 확인한다. */
function assertCoversRangeWithinApiLimits(
  queries: CalendarQuery[],
  expectedStart: string,
  expectedEnd: string,
) {
  assert.ok(queries.length > 0);
  assert.equal(queries[0].startDate, expectedStart);
  assert.equal(queries[queries.length - 1].endDate, expectedEnd);
  for (const query of queries) {
    assert.ok(
      days(query.startDate, query.endDate) <= MAX_QUERY_RANGE_DAYS,
      `${query.startDate}~${query.endDate}가 API 한도 ${MAX_QUERY_RANGE_DAYS}일을 넘습니다`,
    );
  }
  for (let index = 1; index < queries.length; index += 1) {
    assert.equal(
      days(queries[index - 1].endDate, queries[index].startDate),
      1,
      "chunk 사이에 빈 날짜나 겹침이 있습니다",
    );
  }
}

test("September grid includes adjacent-month dates in a single query", () => {
  const queries = calendarQueries("month", "2026-09-18");
  assertCoversRangeWithinApiLimits(queries, "2026-08-31", "2026-10-04");
  assert.equal(queries.length, 1);
});

test("week and day query the selected date, not the old July fixtures", () => {
  assert.deepEqual(calendarQueries("week", "2026-09-18"), [
    { startDate: "2026-09-14", endDate: "2026-09-19" },
  ]);
  assert.deepEqual(calendarQueries("day", "2026-09-18"), [
    { startDate: "2026-09-18", endDate: "2026-09-18" },
  ]);
});

test("six-row and leap-year grids cover all cells within API query limits", () => {
  assertCoversRangeWithinApiLimits(
    calendarQueries("month", "2026-03-18"),
    "2026-02-23",
    "2026-04-05",
  );
  assertCoversRangeWithinApiLimits(
    calendarQueries("month", "2028-02-29"),
    "2028-01-31",
    "2028-03-05",
  );
});
