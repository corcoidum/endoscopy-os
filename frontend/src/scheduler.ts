import type { DayPolicy } from "./dayPolicies";
import type {
  Appointment,
  CareCategory,
  DepositPaymentMethod,
  ProcedureKind,
  ProcedureSet,
  Sex,
} from "./data";

export type CapacityBucket =
  | "STANDARD_MORNING"
  | "AFTERNOON_EXCEPTION"
  | "SAME_DAY_EXTENSION";

export interface MedicationDiscontinuationDraft {
  id: string;
  medicationName: string;
  discontinuationDays: string;
  doctorConfirmed: boolean;
}

export type DepositSelection = "UNSELECTED" | "PAID" | "UNPAID";

export interface BookingDraft {
  id?: string;
  name: string;
  chartNumber: string;
  dateOfBirth: string;
  sex: Sex | "";
  careCategory: CareCategory;
  procedure: ProcedureKind;
  procedureSet: ProcedureSet;
  upperSedation: boolean;
  colonSedation: boolean;
  date: string;
  start: string;
  bucket: CapacityBucket;
  bookingOrigin: "ADVANCE" | "SAME_DAY";
  additionalSlotId?: string;
  sameDayReason: string;
  sameDayPreparationConfirmed: boolean;
  sameDayClinicianConfirmed: boolean;
  sameDayEscortConfirmed: boolean;
  screeningCopay: "없음" | "10%";
  bowelPreparation: string;
  medicationsChecked: boolean;
  medicationListMemo: string;
  medicationDiscontinuations: MedicationDiscontinuationDraft[];
  additionalExaminations: string[];
  depositStatus: DepositSelection;
  depositPaymentMethod: DepositPaymentMethod | "미확인";
  depositAmount?: 10000 | 20000 | 30000;
  additionalPrepayment: boolean;
  exceptionReason: string;
  exceptionConfirmedBy: string;
  exceptionMemo: string;
}

export function isDepositSelectionComplete(
  draft: Pick<BookingDraft, "depositStatus" | "depositAmount" | "depositPaymentMethod">,
): boolean {
  if (draft.depositStatus === "UNPAID") return true;
  return (
    draft.depositStatus === "PAID" &&
    Boolean(draft.depositAmount) &&
    draft.depositPaymentMethod !== "미확인"
  );
}

export interface ValidationResult {
  valid: boolean;
  duration: 30 | 60 | 90;
  end: string;
  errors: string[];
  alternatives: string[];
}

export type ScheduleValidation = Omit<ValidationResult, "alternatives">;

export interface DayAvailability {
  date: string;
  policy: DayPolicy;
  closed: boolean;
  availableStarts: string[];
  upperCount: number;
  colonCount: number;
  afternoonBooked: boolean;
}

export function formatBirthDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export function isValidBirthDate(value: string, referenceDate: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const parsed = new Date(`${value}T00:00:00`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getFullYear() === Number(year) &&
    parsed.getMonth() + 1 === Number(month) &&
    parsed.getDate() === Number(day) &&
    value >= "1900-01-01" &&
    value <= referenceDate
  );
}

export function procedureDuration(
  procedure: ProcedureKind,
  procedureSet: ProcedureSet = "세트60",
): 30 | 60 | 90 {
  if (procedure === "위") return 30;
  if (procedure === "대장") return 60;
  return procedureSet === "세트90" ? 90 : 60;
}

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function fromMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function intervalOverlaps(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

// 원내 기본 오전 운영시간. 날짜별 규칙이 이보다 짧으면 달력에 표시한다.
const STANDARD_MORNING_END_MINUTE = 12 * 60;

/** 기본 오전 운영(~12:00)보다 일찍 끝나는 날인지. */
export function hasShortenedMorning(policy: DayPolicy): boolean {
  return (
    !policy.closed &&
    policy.morningEndMinute !== null &&
    policy.morningEndMinute < STANDARD_MORNING_END_MINUTE
  );
}

/** 오전 운영 종료시각. 휴진일에는 없다. */
export function morningEndLabel(policy: DayPolicy): string | null {
  return policy.morningEndMinute === null ? null : fromMinutes(policy.morningEndMinute);
}

/** "09:00~12:00" 같은 오전 운영시간 표기. 휴진일에는 없다. */
export function morningHoursLabel(policy: DayPolicy): string | null {
  if (policy.morningStartMinute === null || policy.morningEndMinute === null) {
    return null;
  }
  return `${fromMinutes(policy.morningStartMinute)}~${fromMinutes(policy.morningEndMinute)}`;
}

export function standardStartsFor(policy: DayPolicy): string[] {
  if (policy.morningStartMinute === null || policy.morningEndMinute === null) {
    return [];
  }
  const starts: string[] = [];
  for (
    let current = policy.morningStartMinute;
    current < policy.morningEndMinute;
    current += 30
  ) {
    starts.push(fromMinutes(current));
  }
  return starts;
}

function includesUpper(procedure: ProcedureKind) {
  return procedure === "위" || procedure === "위·대장";
}

function includesColon(procedure: ProcedureKind) {
  return procedure === "대장" || procedure === "위·대장";
}

function sameDayAppointments(
  appointments: Appointment[],
  date: string,
  excludeAppointmentId?: string,
) {
  return appointments.filter(
    (appointment) =>
      appointment.date === date && appointment.id !== excludeAppointmentId,
  );
}

/** 환자·복용약·예외 사유 같은 입력 항목은 제외하고 일정 규칙만 검증합니다. */
export function validateSchedule(
  draft: BookingDraft,
  appointments: Appointment[],
  policy: DayPolicy,
  excludeAppointmentId?: string,
): ScheduleValidation {
  const duration = procedureDuration(draft.procedure, draft.procedureSet);
  const start = toMinutes(draft.start);
  const end = start + duration;
  const errors: string[] = [];
  const sameDay = sameDayAppointments(appointments, draft.date, excludeAppointmentId);

  if (policy.closed) {
    errors.push(
      new Date(`${draft.date}T00:00:00`).getDay() === 0
        ? "일요일은 휴진일이라 예약할 수 없습니다."
        : "선택한 날짜는 휴진일로 지정되어 예약할 수 없습니다.",
    );
  }

  if (start % 30 !== 0) {
    errors.push("예약 시간은 30분 단위로 선택해야 합니다.");
  }

  if (draft.bucket === "SAME_DAY_EXTENSION") {
    if (draft.bookingOrigin !== "SAME_DAY" || draft.procedure !== "위") {
      errors.push("당일 연장 슬롯은 위내시경에만 사용할 수 있습니다.");
    }
  } else if (draft.bucket === "AFTERNOON_EXCEPTION") {
    if (draft.start !== "14:00") {
      errors.push("오후 예외 예약은 14:00만 선택할 수 있습니다.");
    }

    if (!policy.afternoonAllowed) {
      errors.push("선택한 날짜는 14:00 오후 예외가 허용되지 않았습니다.");
    }

    const afternoonAlreadyBooked = sameDay.some(
      (appointment) => appointment.afternoonException,
    );
    if (afternoonAlreadyBooked) {
      errors.push("이 날짜의 14:00 오후 예외 예약은 이미 1명이 등록되어 있습니다.");
    }
  } else {
    const operatingStart = policy.morningStartMinute;
    const operatingEnd = policy.morningEndMinute;
    if (
      operatingStart === null ||
      operatingEnd === null ||
      start < operatingStart ||
      end > operatingEnd
    ) {
      const endingLabel = morningEndLabel(policy);
      errors.push(
        endingLabel === null
          ? `${draft.start}은 오전 운영시간이 없는 날짜입니다.`
          : `${draft.start} 시작 시 ${fromMinutes(end)}에 종료되어 오전 운영 종료 ${endingLabel}을 초과합니다.`,
      );
    }

    const standardAppointments = sameDay.filter(
      (appointment) => !appointment.afternoonException,
    );
    const upperCount =
      standardAppointments.filter((appointment) => includesUpper(appointment.procedure))
        .length + (includesUpper(draft.procedure) ? 1 : 0);
    const colonCount =
      standardAppointments.filter((appointment) => includesColon(appointment.procedure))
        .length + (includesColon(draft.procedure) ? 1 : 0);

    if (policy.upperCapacity !== null && upperCount > policy.upperCapacity) {
      errors.push(`오전 위내시경 일반 수용량 ${policy.upperCapacity}건을 초과합니다.`);
    }
    if (policy.colonCapacity !== null && colonCount > policy.colonCapacity) {
      errors.push(`오전 대장내시경 일반 수용량 ${policy.colonCapacity}건을 초과합니다.`);
    }
  }

  const conflict = sameDay.find((appointment) => {
    const existingStart = toMinutes(appointment.start);
    const existingEnd = existingStart + appointment.duration;
    return intervalOverlaps(start, end, existingStart, existingEnd);
  });

  if (conflict) {
    errors.push(
      `${draft.start}은 ${conflict.name}님의 ${conflict.start}~${fromMinutes(
        toMinutes(conflict.start) + conflict.duration,
      )} 예약과 겹칩니다.`,
    );
  }

  return {
    valid: errors.length === 0,
    duration,
    end: fromMinutes(end),
    errors,
  };
}

/** 선택한 검사 종류·세트·예약 구분 기준으로 하루의 예약 가능 시간을 계산합니다. */
export function dayAvailability(
  draft: BookingDraft,
  appointments: Appointment[],
  date: string,
  policy: DayPolicy,
  excludeAppointmentId?: string,
): DayAvailability {
  const closed = policy.closed;
  const candidateStarts =
    draft.bucket === "AFTERNOON_EXCEPTION" ? ["14:00"] : standardStartsFor(policy);
  const availableStarts = closed
    ? []
    : candidateStarts.filter(
        (start) =>
          validateSchedule(
            { ...draft, date, start },
            appointments,
            policy,
            excludeAppointmentId,
          ).valid,
      );
  const sameDay = sameDayAppointments(appointments, date, excludeAppointmentId);
  const standardAppointments = sameDay.filter(
    (appointment) => !appointment.afternoonException,
  );

  return {
    date,
    policy,
    closed,
    availableStarts,
    upperCount: standardAppointments.filter((appointment) =>
      includesUpper(appointment.procedure),
    ).length,
    colonCount: standardAppointments.filter((appointment) =>
      includesColon(appointment.procedure),
    ).length,
    afternoonBooked: sameDay.some((appointment) => appointment.afternoonException),
  };
}

export function validateBooking(
  draft: BookingDraft,
  appointments: Appointment[],
  policy: DayPolicy,
  excludeAppointmentId?: string,
  calculateAlternatives = true,
): ValidationResult {
  const schedule = validateSchedule(draft, appointments, policy, excludeAppointmentId);
  const errors: string[] = [];

  if (!draft.name.trim() || !draft.chartNumber.trim() || !draft.dateOfBirth || !draft.sex) {
    errors.push("환자 이름·차트번호·생년월일·성별을 모두 확인해 주세요.");
  } else if (!isValidBirthDate(draft.dateOfBirth, draft.date)) {
    errors.push("생년월일을 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.");
  }

  draft.medicationDiscontinuations.forEach((medication, index) => {
    const medicationName = medication.medicationName.trim();
    const medicationDays = medication.discontinuationDays.trim();
    const hasAnyValue = medicationName || medicationDays || medication.doctorConfirmed;
    if (!hasAnyValue) return;
    if (!medicationName || !medicationDays) {
      errors.push(
        `중단 검토 약 ${index + 1}: 약품명과 의사가 결정한 중단 일수를 함께 입력해 주세요.`,
      );
    } else if (!/^\d+$/.test(medicationDays)) {
      errors.push(
        `중단 검토 약 ${index + 1}: 중단 일수는 0 이상의 정수로 입력해 주세요.`,
      );
    } else if (!medication.doctorConfirmed) {
      errors.push(`중단 검토 약 ${index + 1}: 담당 의사의 확인이 필요합니다.`);
    }
  });

  errors.push(...schedule.errors);

  if (
    draft.bucket === "AFTERNOON_EXCEPTION" &&
    (!draft.exceptionReason.trim() ||
      !draft.exceptionConfirmedBy.trim() ||
      !draft.exceptionMemo.trim())
  ) {
    errors.push("오후 예외 사유·확인자·관련 메모를 모두 입력해 주세요.");
  }

  let alternatives: string[] = [];
  if (calculateAlternatives && !schedule.valid) {
    alternatives = dayAvailability(
      draft,
      appointments,
      draft.date,
      policy,
      excludeAppointmentId,
    ).availableStarts.slice(0, 3);
  }

  return {
    valid: errors.length === 0,
    duration: schedule.duration,
    end: schedule.end,
    errors,
    alternatives,
  };
}
