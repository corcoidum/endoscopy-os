import {
  type Appointment,
} from "./data";
import {
  fromMinutes,
  isValidBirthDate,
  procedureDuration,
  toMinutes,
  type BookingDraft,
  type ValidationResult,
} from "./scheduler";
import { seoulTodayIso } from "./calendarDates";

export const WIZARD_STEPS = [
  "환자 확인",
  "검사 종류와 일정",
  "검진 정보",
  "장정결제",
  "복용약·수술이력",
  "추가 검사",
  "예약금",
  "최종 확인",
];

export function draftFromAppointment(
  appointment?: Appointment,
  bookingOrigin: BookingDraft["bookingOrigin"] = "ADVANCE",
): BookingDraft {
  if (appointment) {
    return {
      id: appointment.id,
      name: appointment.name,
      chartNumber: appointment.chartNumber,
      dateOfBirth: appointment.dateOfBirth,
      sex: appointment.sex,
      careCategory: appointment.careCategory,
      procedure: appointment.procedure,
      procedureSet:
        appointment.procedureSet ?? (appointment.duration === 90 ? "세트90" : "세트60"),
      upperSedation: appointment.upperSedation ?? false,
      colonSedation: appointment.colonSedation ?? false,
      date: appointment.date,
      start: appointment.start,
      bucket: appointment.afternoonException
        ? "AFTERNOON_EXCEPTION"
        : appointment.sameDayExtension
          ? "SAME_DAY_EXTENSION"
        : "STANDARD_MORNING",
      bookingOrigin: appointment.sameDay ? "SAME_DAY" : "ADVANCE",
      additionalSlotId: appointment.additionalSlotId,
      sameDayReason: appointment.sameDayReason ?? "",
      sameDayPreparationConfirmed: appointment.sameDayPreparationConfirmed ?? false,
      sameDayClinicianConfirmed: appointment.sameDayClinicianConfirmed ?? false,
      sameDayEscortConfirmed: appointment.sameDayEscortConfirmed ?? false,
      screeningCopay: appointment.screeningCopay ?? "없음",
      bowelPreparation: appointment.bowelPreparation ?? "원프렙",
      medicationsChecked: appointment.medication === "완료",
      medicationListMemo: appointment.medicationListMemo ?? "",
      medicationDiscontinuations:
        appointment.medicationDiscontinuations?.map((medication, index) => ({
          id: `existing-medication-${index + 1}`,
          medicationName: medication.medicationName,
          discontinuationDays: medication.discontinuationDays.toString(),
          doctorConfirmed: medication.doctorConfirmed,
        })) ??
        [
          {
            id: "existing-medication-1",
            medicationName: appointment.medicationDiscontinuationName ?? "",
            discontinuationDays:
              appointment.medicationDiscontinuationDays?.toString() ?? "",
            doctorConfirmed: appointment.medicationDoctorConfirmed ?? false,
          },
        ],
      additionalExaminations: appointment.additionalExaminations ?? [],
      depositStatus:
        appointment.deposit === "완료"
          ? "PAID"
          : appointment.depositUnpaidConfirmed
            ? "UNPAID"
            : "UNSELECTED",
      depositPaymentMethod: appointment.depositPaymentMethod ?? "미확인",
      depositAmount: appointment.depositAmount,
      additionalPrepayment: appointment.additionalPrepayment ?? false,
      exceptionReason: appointment.exceptionReason ?? "",
      exceptionConfirmedBy: appointment.exceptionConfirmedBy ?? "",
      exceptionMemo: appointment.memo ?? "",
    };
  }

  return {
    name: "",
    chartNumber: "",
    dateOfBirth: "",
    sex: "",
    careCategory: "검진",
    procedure: bookingOrigin === "SAME_DAY" ? "위" : "위·대장",
    procedureSet: "세트60",
    upperSedation: true,
    colonSedation: false,
    date: bookingOrigin === "SAME_DAY" ? seoulTodayIso() : "2026-08-01",
    start: bookingOrigin === "SAME_DAY" ? "09:00" : "10:30",
    bucket: "STANDARD_MORNING",
    bookingOrigin,
    sameDayReason: "",
    sameDayPreparationConfirmed: false,
    sameDayClinicianConfirmed: false,
    sameDayEscortConfirmed: false,
    screeningCopay: "없음",
    bowelPreparation: "원프렙",
    medicationsChecked: false,
    medicationListMemo: "",
    medicationDiscontinuations: [
      {
        id: "new-medication-1",
        medicationName: "",
        discontinuationDays: "",
        doctorConfirmed: false,
      },
    ],
    additionalExaminations: [],
    depositStatus: "UNSELECTED",
    depositPaymentMethod: "미확인",
    depositAmount: undefined,
    additionalPrepayment: false,
    exceptionReason: "",
    exceptionConfirmedBy: "",
    exceptionMemo: "",
  };
}

export function validateBackendBookingDraft(draft: BookingDraft): ValidationResult {
  const duration = procedureDuration(draft.procedure, draft.procedureSet);
  const errors: string[] = [];
  if (!draft.name.trim() || !draft.chartNumber.trim() || !draft.dateOfBirth || !draft.sex) {
    errors.push("환자 이름·차트번호·생년월일·성별을 모두 확인해 주세요.");
  } else if (!isValidBirthDate(draft.dateOfBirth, draft.date)) {
    errors.push("생년월일을 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.");
  }
  if (draft.bucket === "AFTERNOON_EXCEPTION" && !draft.exceptionReason.trim()) {
    errors.push("14:00 오후 예외 예약에는 사유가 필요합니다.");
  }
  if (draft.bookingOrigin === "SAME_DAY") {
    if (draft.date !== seoulTodayIso()) {
      errors.push("당일 위내시경은 오늘 날짜로만 등록할 수 있습니다.");
    }
    if (draft.procedure !== "위") {
      errors.push("당일 추가 검사는 위내시경만 등록할 수 있습니다.");
    }
    if (!draft.sameDayReason.trim()) {
      errors.push("당일 위내시경 요청 사유를 입력해 주세요.");
    }
    if (!draft.sameDayPreparationConfirmed || !draft.sameDayClinicianConfirmed) {
      errors.push("검사 준비와 의료진 시행 가능 확인이 필요합니다.");
    }
    if (draft.upperSedation && !draft.sameDayEscortConfirmed) {
      errors.push("수면 위내시경은 귀가 동행 확인이 필요합니다.");
    }
    if (draft.bucket === "SAME_DAY_EXTENSION" && !draft.additionalSlotId) {
      errors.push("승인된 30분 연장 슬롯을 선택해 주세요.");
    }
  }
  return {
    valid: errors.length === 0,
    duration,
    end: fromMinutes(toMinutes(draft.start) + duration),
    errors,
    alternatives: [],
  };
}
