import type { Appointment } from "./data";
import type { StatisticsPeriod, ViewId } from "./viewTypes";

export const REFERENCE_TODAY = "2026-09-18";
export const KOREAN_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toIsoDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function seoulTodayIso(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function addCalendarDays(value: string, amount: number): string {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + amount);
  return toIsoDate(date);
}

export function addCalendarMonths(value: string, amount: number): string {
  const date = parseIsoDate(value);
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  return toIsoDate(date);
}

export function addCalendarYears(value: string, amount: number): string {
  const date = parseIsoDate(value);
  date.setFullYear(date.getFullYear() + amount);
  return toIsoDate(date);
}

export function startOfCalendarWeek(value: string): string {
  const date = parseIsoDate(value);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return toIsoDate(date);
}

export function weekDaysFor(value: string) {
  const monday = startOfCalendarWeek(value);
  return Array.from({ length: 6 }, (_, index) => {
    const iso = addCalendarDays(monday, index);
    const date = parseIsoDate(iso);
    return {
      date: iso,
      label: `${KOREAN_WEEKDAYS[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}`,
      today: iso === REFERENCE_TODAY,
    };
  });
}

export function monthGridDays(value: string) {
  const visibleMonth = parseIsoDate(value);
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const leadingDays = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
  const days = Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(year, month, 1 + index - leadingDays);
    return {
      iso: toIsoDate(date),
      day: date.getDate(),
      currentMonth: date.getMonth() === month,
      sunday: date.getDay() === 0,
    };
  });
  return { year, month, days };
}

export function koreanDateLabel(value: string): string {
  const date = parseIsoDate(value);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${KOREAN_WEEKDAYS[date.getDay()]}요일`;
}

export function periodLabel(view: ViewId, value: string): string {
  const date = parseIsoDate(value);
  if (view === "month") return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
  if (view === "day") return koreanDateLabel(value);
  const monday = startOfCalendarWeek(value);
  const saturday = addCalendarDays(monday, 5);
  const mondayDate = parseIsoDate(monday);
  const saturdayDate = parseIsoDate(saturday);
  const weekNumber = Math.ceil(
    ((mondayDate.getTime() - new Date(mondayDate.getFullYear(), 0, 1).getTime()) /
      86400000 +
      new Date(mondayDate.getFullYear(), 0, 1).getDay() +
      1) /
      7,
  );
  return `${mondayDate.getFullYear()}년 ${mondayDate.getMonth() + 1}월 ${mondayDate.getDate()}일 ~ ${saturdayDate.getMonth() + 1}월 ${saturdayDate.getDate()}일 (${weekNumber}주)`;
}

export function statisticsPeriodLabel(period: StatisticsPeriod, value: string): string {
  const date = parseIsoDate(value);
  if (period === "month") {
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
  }
  if (period === "year") return `${date.getFullYear()}년`;
  return periodLabel("week", value);
}

export function appointmentsForStatisticsPeriod(
  appointments: Appointment[],
  period: StatisticsPeriod,
  value: string,
): Appointment[] {
  if (period === "year") {
    return appointments.filter((item) => item.date.startsWith(`${value.slice(0, 4)}-`));
  }
  if (period === "month") {
    return appointments.filter((item) => item.date.startsWith(value.slice(0, 7)));
  }
  const start = startOfCalendarWeek(value);
  const end = addCalendarDays(start, 5);
  return appointments.filter((item) => item.date >= start && item.date <= end);
}

export function formatDateKorean(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(parsed.getDate()).padStart(2, "0")}`;
}
