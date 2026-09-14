import type {
  Appointment,
  CareCategory,
  DepositPaymentMethod,
  ProcedureKind,
  Sex,
} from "./data";

export type CapacityBucket = "STANDARD_MORNING" | "AFTERNOON_EXCEPTION";

export interface BookingDraft {
  id?: string;
  name: string;
  chartNumber: string;
  dateOfBirth: string;
  sex: Sex;
  careCategory: CareCategory;
  procedure: ProcedureKind;
  upperSedation: boolean;
  colonSedation: boolean;
  date: string;
  start: string;
  bucket: CapacityBucket;
  screeningCopay: "없음" | "10%";
  bowelPreparation: string;
  medicationsChecked: boolean;
  medicationDiscontinuationName: string;
  medicationDiscontinuationDays: string;
  medicationDoctorConfirmed: boolean;
  additionalExaminations: string[];
  depositPaid: boolean;
  depositPaymentMethod: DepositPaymentMethod | "미확인";
  depositAmount?: 10000 | 20000 | 30000;
  additionalPrepayment: boolean;
  exceptionReason: string;
  exceptionConfirmedBy: string;
  exceptionMemo: string;
}

export interface ValidationResult {
  valid: boolean;
  duration: 30 | 60;
  end: string;
  errors: string[];
  alternatives: string[];
}

const DATE_BLOCKS: Record<string, { start: string; end: string; reason: string }[]> = {
  "2026-07-29": [
    {
      start: "10:30",
      end: "11:00",
      reason: "장비 점검 승인 차단",
    },
  ],
};

export function getDateBlocks(date: string) {
  return DATE_BLOCKS[date] ?? [];
}

export function procedureDuration(procedure: ProcedureKind): 30 | 60 {
  return procedure === "위" ? 30 : 60;
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

export function isShortMorning(date: string): boolean {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 3 || day === 6;
}

export function standardStartsFor(date: string): string[] {
  const end = isShortMorning(date) ? 11 * 60 : 12 * 60;
  const starts: string[] = [];
  for (let current = 9 * 60; current < end; current += 30) {
    starts.push(fromMinutes(current));
  }
  return starts;
}

export function validateBooking(
  draft: BookingDraft,
  appointments: Appointment[],
  excludeAppointmentId?: string,
  calculateAlternatives = true,
): ValidationResult {
  const duration = procedureDuration(draft.procedure);
  const start = toMinutes(draft.start);
  const end = start + duration;
  const errors: string[] = [];
  const sameDay = appointments.filter(
    (appointment) =>
      appointment.date === draft.date && appointment.id !== excludeAppointmentId,
  );

  if (!draft.name.trim() || !draft.chartNumber.trim() || !draft.dateOfBirth) {
    errors.push("환자 이름·차트번호·생년월일을 모두 확인해 주세요.");
  }

  const medicationName = draft.medicationDiscontinuationName.trim();
  const medicationDays = draft.medicationDiscontinuationDays.trim();
  if (medicationName || medicationDays) {
    if (!medicationName || !medicationDays) {
      errors.push("중단 검토 약품명과 의사가 결정한 중단 일수를 함께 입력해 주세요.");
    } else if (!/^\d+$/.test(medicationDays)) {
      errors.push("약제 중단 일수는 0 이상의 정수로 입력해 주세요.");
    } else if (!draft.medicationDoctorConfirmed) {
      errors.push("담당 의사의 약제 확인이 필요합니다.");
    }
  }

  if (start % 30 !== 0) {
    errors.push("예약 시간은 30분 단위로 선택해야 합니다.");
  }

  if (draft.bucket === "AFTERNOON_EXCEPTION") {
    if (draft.start !== "14:00") {
      errors.push("오후 예외 예약은 14:00만 선택할 수 있습니다.");
    }

    const afternoonAlreadyBooked = sameDay.some(
      (appointment) => appointment.afternoonException,
    );
    if (afternoonAlreadyBooked) {
      errors.push("이 날짜의 14:00 오후 예외 예약은 이미 1명이 등록되어 있습니다.");
    }

    if (
      !draft.exceptionReason.trim() ||
      !draft.exceptionConfirmedBy.trim() ||
      !draft.exceptionMemo.trim()
    ) {
      errors.push("오후 예외 사유·확인자·관련 메모를 모두 입력해 주세요.");
    }
  } else {
    const operatingEnd = isShortMorning(draft.date) ? 11 * 60 : 12 * 60;
    if (start < 9 * 60 || end > operatingEnd) {
      const endingLabel = isShortMorning(draft.date) ? "11:00" : "12:00";
      errors.push(
        `${draft.start} 시작 시 ${fromMinutes(end)}에 종료되어 오전 운영 종료 ${endingLabel}을 초과합니다.`,
      );
    }

    const block = getDateBlocks(draft.date).find((item) =>
      intervalOverlaps(start, end, toMinutes(item.start), toMinutes(item.end)),
    );
    if (block) {
      errors.push(
        `${block.start}~${block.end}은 '${block.reason}'으로 차단된 시간입니다.`,
      );
    }

    if (!isShortMorning(draft.date)) {
      const standardAppointments = sameDay.filter(
        (appointment) => !appointment.afternoonException,
      );
      const upperCount =
        standardAppointments.filter(
          (appointment) =>
            appointment.procedure === "위" ||
            appointment.procedure === "위·대장",
        ).length +
        (draft.procedure === "위" || draft.procedure === "위·대장" ? 1 : 0);
      const colonCount =
        standardAppointments.filter(
          (appointment) =>
            appointment.procedure === "대장" ||
            appointment.procedure === "위·대장",
        ).length +
        (draft.procedure === "대장" || draft.procedure === "위·대장" ? 1 : 0);

      if (upperCount > 5) errors.push("오전 위내시경 일반 수용량 5건을 초과합니다.");
      if (colonCount > 3) errors.push("오전 대장내시경 일반 수용량 3건을 초과합니다.");
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

  let alternatives: string[] = [];
  if (calculateAlternatives && errors.length > 0) {
    const candidateStarts =
      draft.bucket === "AFTERNOON_EXCEPTION"
        ? ["14:00"]
        : standardStartsFor(draft.date);
    alternatives = candidateStarts
      .filter((candidateStart) => {
        const candidate = {
          ...draft,
          start: candidateStart,
        };
        return validateBooking(
          candidate,
          appointments,
          excludeAppointmentId,
          false,
        ).valid;
      })
      .slice(0, 3);
  }

  return {
    valid: errors.length === 0,
    duration,
    end: fromMinutes(end),
    errors,
    alternatives,
  };
}
