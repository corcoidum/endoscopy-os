import { useState } from "react";
import {
  addCalendarDays,
  addCalendarMonths,
  KOREAN_WEEKDAYS,
  koreanDateLabel,
  monthGridDays,
  parseIsoDate,
  REFERENCE_TODAY,
} from "./calendarDates";
import {
  dayAvailability,
  hasShortenedMorning,
  morningHoursLabel,
  type BookingDraft,
} from "./scheduler";
import type { DayPolicyLookup } from "./dayPolicies";
import type { Appointment } from "./data";

export const BOOKING_CALENDAR_WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
export const BOOKING_WINDOW_END = addCalendarDays(addCalendarMonths(REFERENCE_TODAY, 4), -1);

export function shortDateLabel(value: string): string {
  const date = parseIsoDate(value);
  return `${date.getMonth() + 1}/${date.getDate()}(${KOREAN_WEEKDAYS[date.getDay()]})`;
}

export function bookingDayTitle(
  availability: ReturnType<typeof dayAvailability>,
  bucket: BookingDraft["bucket"],
): string {
  const label = koreanDateLabel(availability.date);
  if (availability.closed) return `${label} · 휴진`;
  const { policy } = availability;
  const usage =
    bucket === "AFTERNOON_EXCEPTION"
      ? `14시 예외 ${availability.afternoonBooked ? 1 : 0}/1`
      : policy.upperCapacity === null || policy.colonCapacity === null
        ? `운영 ${morningHoursLabel(policy) ?? "미정"}`
        : `위 ${availability.upperCount}/${policy.upperCapacity} · 대장 ${availability.colonCount}/${policy.colonCapacity}`;
  const starts = availability.availableStarts.length
    ? `가능 ${availability.availableStarts.join(", ")}`
    : "가능 시간 없음";
  return `${label} · ${usage} · ${starts}`;
}

export function BookingDatePicker({
  draft,
  appointments,
  dayPolicy,
  excludeAppointmentId,
  onSelectDate,
}: {
  draft: BookingDraft;
  appointments: Appointment[];
  dayPolicy: DayPolicyLookup;
  excludeAppointmentId?: string;
  onSelectDate: (date: string) => void;
}) {
  const [visibleMonth, setVisibleMonth] = useState(() =>
    addCalendarMonths(draft.date, 0),
  );
  const { year, month, days } = monthGridDays(visibleMonth);
  const availabilityFor = (date: string) =>
    dayAvailability(draft, appointments, date, dayPolicy(date), excludeAppointmentId);
  const selected = availabilityFor(draft.date);

  const nextAvailable: ReturnType<typeof dayAvailability>[] = [];
  for (
    let date =
      draft.date >= REFERENCE_TODAY ? addCalendarDays(draft.date, 1) : REFERENCE_TODAY;
    date <= BOOKING_WINDOW_END && nextAvailable.length < 3;
    date = addCalendarDays(date, 1)
  ) {
    const availability = availabilityFor(date);
    if (availability.availableStarts.length > 0) nextAvailable.push(availability);
  }

  const selectDate = (date: string) => {
    setVisibleMonth(addCalendarMonths(date, 0));
    onSelectDate(date);
  };

  return (
    <div className="booking-calendar">
      <div className="booking-calendar__header">
        <button
          type="button"
          className="booking-calendar__nav"
          aria-label="이전 달"
          disabled={visibleMonth <= addCalendarMonths(REFERENCE_TODAY, 0)}
          onClick={() => setVisibleMonth(addCalendarMonths(visibleMonth, -1))}
        >
          ‹
        </button>
        <strong>
          {year}년 {month + 1}월
        </strong>
        <button
          type="button"
          className="booking-calendar__nav"
          aria-label="다음 달"
          disabled={visibleMonth >= addCalendarMonths(BOOKING_WINDOW_END, 0)}
          onClick={() => setVisibleMonth(addCalendarMonths(visibleMonth, 1))}
        >
          ›
        </button>
        <span>선택: {koreanDateLabel(draft.date)}</span>
      </div>
      <div className="booking-calendar__grid">
        {BOOKING_CALENDAR_WEEKDAYS.map((weekday) => (
          <div className="booking-calendar__weekday" key={weekday}>
            {weekday}
          </div>
        ))}
        {days.map((day) => {
          if (!day.currentMonth) {
            return (
              <span
                className="booking-calendar__cell is-outside"
                aria-hidden="true"
                key={day.iso}
              />
            );
          }
          const availability = availabilityFor(day.iso);
          const isSelected = day.iso === draft.date;
          const outOfWindow = day.iso < REFERENCE_TODAY || day.iso > BOOKING_WINDOW_END;
          const count = availability.availableStarts.length;
          const state = availability.closed
            ? "is-closed"
            : outOfWindow
              ? "is-past"
              : count > 0
                ? "is-available"
                : "is-full";
          const label = availability.closed
            ? "휴진"
            : outOfWindow
              ? ""
              : count > 0
                ? `가능 ${count}`
                : "마감";
          return (
            <button
              type="button"
              className={`booking-calendar__cell ${state} ${isSelected ? "is-selected" : ""}`}
              disabled={(availability.closed || outOfWindow) && !isSelected}
              aria-pressed={isSelected}
              aria-label={`${koreanDateLabel(day.iso)} ${label}`}
              title={bookingDayTitle(availability, draft.bucket)}
              onClick={() => selectDate(day.iso)}
              key={day.iso}
            >
              <span>{day.day}</span>
              {label && <small>{label}</small>}
              {hasShortenedMorning(availability.policy) &&
                !outOfWindow &&
                draft.bucket === "STANDARD_MORNING" && <em>단축</em>}
            </button>
          );
        })}
      </div>
      {selected.availableStarts.length === 0 && (
        <p className="booking-calendar__notice" role="status">
          {selected.closed
            ? "선택한 날짜는 휴진일입니다."
            : "선택한 날짜에는 현재 검사 조건으로 예약 가능한 시간이 없습니다."}{" "}
          아래 다음 가능일을 선택해 주세요.
        </p>
      )}
      <div className="booking-calendar__quick">
        <span>다음 가능일</span>
        {nextAvailable.length > 0 ? (
          nextAvailable.map((item) => (
            <button type="button" onClick={() => selectDate(item.date)} key={item.date}>
              {shortDateLabel(item.date)} · {item.availableStarts.length}개
            </button>
          ))
        ) : (
          <span>{shortDateLabel(BOOKING_WINDOW_END)}까지 가능한 날짜가 없습니다.</span>
        )}
      </div>
    </div>
  );
}
