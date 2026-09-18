import assert from "node:assert/strict";
import test from "node:test";
import { calendarQueries } from "../src/calendarQueries.ts";

test("September grid includes adjacent-month dates without overlapping query chunks", () => {
  assert.deepEqual(calendarQueries("month", "2026-09-18"), [
    { startDate: "2026-08-31", endDate: "2026-09-30" },
    { startDate: "2026-10-01", endDate: "2026-10-04" },
  ]);
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
  assert.deepEqual(calendarQueries("month", "2026-03-18"), [
    { startDate: "2026-02-23", endDate: "2026-03-25" },
    { startDate: "2026-03-26", endDate: "2026-04-05" },
  ]);
  assert.deepEqual(calendarQueries("month", "2028-02-29"), [
    { startDate: "2028-01-31", endDate: "2028-03-01" },
    { startDate: "2028-03-02", endDate: "2028-03-05" },
  ]);
});
