// Include adjacent-month cells; split queries to respect the Backend 31-day limit.
export function calendarQueries(view: string, value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const add = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);
  let start = date;
  let end = date;
  if (view === "month") {
    const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12));
    start = add(first, -((first.getUTCDay() + 6) % 7));
    end = add(last, (7 - last.getUTCDay()) % 7);
  } else if (view !== "day") {
    start = add(date, -((date.getUTCDay() + 6) % 7));
    end = add(start, 5);
  }
  const queries: Array<{ startDate: string; endDate: string }> = [];
  for (let cursor = start; cursor <= end;) {
    const chunkEnd = new Date(Math.min(add(cursor, 30).getTime(), end.getTime()));
    queries.push({ startDate: iso(cursor), endDate: iso(chunkEnd) });
    cursor = add(chunkEnd, 1);
  }
  return queries;
}
