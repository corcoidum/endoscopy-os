import type { AppointmentEventType, AppointmentHistoryEvent } from "./appointmentsApi";
import type { Appointment } from "./data";
import type { VerificationState, VerificationSubject } from "./verificationsApi";

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

const SEOUL_DATE_TIME = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** 확인·무효화 시각을 서울 기준으로 표시한다. */
export function formatSeoulDateTime(value: string): string {
  return SEOUL_DATE_TIME.format(new Date(value));
}

/** "검진 45 · 여", "일반 만 44 · 여"처럼 나이 옆에 성별을 붙인다. */
export function subjectAgeSex(subject: VerificationSubject): string {
  const sex = subject.sex === "FEMALE" ? "여" : "남";
  return subject.age_method === "SCREENING_YEAR_AGE"
    ? `검진 ${subject.computed_age} · ${sex}`
    : `일반 만 ${subject.computed_age} · ${sex}`;
}

/** "위(수면)·대장(비수면) · 세트90"처럼 검사 구성과 수면 여부를 한 줄로 쓴다. */
export function subjectProcedures(subject: VerificationSubject): string {
  const procedures = subject.procedures
    .map((item) => {
      const name = item.procedure_code === "COLON" ? "대장" : "위";
      return `${name}(${item.sedation_mode === "SEDATED" ? "수면" : "비수면"})`;
    })
    .join("·");
  if (subject.procedure_set === null) return procedures;
  return `${procedures} · ${subject.procedure_set === "SET_90" ? "세트90" : "세트60"}`;
}

/** 확인 업무에서 먼저 처리할 순서: 재확인 → 1차 대기 → 2차 대기. */
export const VERIFICATION_QUEUE_ORDER: VerificationState[] = [
  "REVERIFY_REQUIRED",
  "UNVERIFIED",
  "PRIMARY_DONE",
];

/** 이중확인이 끝나지 않은 실제 예약만 처리 순서와 일시 순으로 늘어놓는다. */
export function verificationQueue<T extends Pick<Appointment, "date" | "start" | "verificationState">>(
  appointments: T[],
): T[] {
  return appointments
    .filter((item) => item.verificationState && item.verificationState !== "VERIFIED")
    .sort((left, right) => {
      const byState =
        VERIFICATION_QUEUE_ORDER.indexOf(left.verificationState as VerificationState) -
        VERIFICATION_QUEUE_ORDER.indexOf(right.verificationState as VerificationState);
      if (byState !== 0) return byState;
      return `${left.date} ${left.start}`.localeCompare(`${right.date} ${right.start}`);
    });
}
