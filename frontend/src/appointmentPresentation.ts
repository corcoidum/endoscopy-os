import type { AppointmentEventType, AppointmentHistoryEvent } from "./appointmentsApi";
import type { Appointment } from "./data";

export const EVENT_LABELS: Record<AppointmentEventType, string> = {
  CREATED: "예약 등록",
  UPDATED: "예약 변경",
  CANCELLED: "예약 취소",
  NO_SHOW: "No-show 기록",
  EXCEPTION_CONFIRMED: "오후 예외 확인",
};

// 직원이 알아볼 필요가 있는 항목만 풀어서 보여 준다.
const FIELD_LABELS: Record<string, string> = {
  service_date: "검사일",
  start_time: "시작",
  end_time: "종료",
  procedures: "검사",
  procedure_set: "세트",
  care_type: "진료 구분",
  workflow_state: "상태",
  exception_status: "오후 예외 확인",
};

const VALUE_LABELS: Record<string, string> = {
  GENERAL: "일반",
  SCREENING: "검진",
  SET_60: "세트60",
  SET_90: "세트90",
  BOOKED: "예약",
  CANCELLED: "취소",
  NO_SHOW: "No-show",
  PENDING: "확인 대기",
  CONFIRMED: "확인",
  NOT_APPLICABLE: "해당 없음",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "없음";
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const procedure = item as { procedure_code?: string; sedation_mode?: string };
        const name = procedure.procedure_code === "COLON" ? "대장" : "위";
        return procedure.sedation_mode === "SEDATED" ? `${name}(수면)` : name;
      })
      .join("·");
  }
  const text = String(value);
  return VALUE_LABELS[text] ?? text;
}

/** 변경 이력에서 "시작: 09:00 → 10:00" 같은 한 줄 설명을 만든다. */
export function describeHistoryChanges(event: AppointmentHistoryEvent): string[] {
  if (event.event_type === "CREATED" || !event.before_values) return [];
  const before = event.before_values;
  return event.changed_fields
    .filter((field) => field in FIELD_LABELS)
    .map(
      (field) =>
        `${FIELD_LABELS[field]}: ${formatValue(before[field])} → ${formatValue(
          event.after_values[field],
        )}`,
    );
}

/** 예약 시작시각(서울)이 이미 지났는지. No-show는 그 뒤에만 기록할 수 있다. */
export function appointmentHasStarted(
  appointment: Pick<Appointment, "date" | "start">,
  now = new Date(),
): boolean {
  return new Date(`${appointment.date}T${appointment.start}:00+09:00`) <= now;
}
