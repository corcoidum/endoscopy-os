import { ApiError, apiRequest } from "./api.ts";
import type { Appointment, CareCategory, ProcedureKind, ProcedureSet } from "./data";
import type { BookingDraft } from "./scheduler";
import type { VerificationState } from "./verificationsApi";

export type ProcedureCode = "UPPER" | "COLON";
export type ProcedureSetCode = "SET_60" | "SET_90";
export type BookingBucket =
  | "STANDARD_MORNING"
  | "AFTERNOON_EXCEPTION"
  | "SAME_DAY_EXTENSION";

type AppointmentProcedureResponse = {
  procedure_code: ProcedureCode;
  sedation_mode: "SEDATED" | "NON_SEDATED";
};

export type AppointmentResponse = {
  id: string;
  patient_id: string;
  patient_name: string;
  chart_number: string;
  birth_date: string;
  sex: "MALE" | "FEMALE";
  service_date: string;
  start_time: string;
  duration_minutes: 30 | 60 | 90;
  procedure_set: ProcedureSetCode | null;
  care_type: "GENERAL" | "SCREENING";
  booking_bucket: BookingBucket;
  booking_origin: "ADVANCE" | "SAME_DAY";
  additional_slot_id: string | null;
  same_day_reason: string | null;
  same_day_preparation_confirmed: boolean;
  same_day_clinician_confirmed: boolean;
  same_day_escort_confirmed: boolean;
  same_day_confirmed_at: string | null;
  workflow_state: "BOOKED" | "CANCELLED" | "NO_SHOW";
  exception_status: "NOT_APPLICABLE" | "PENDING" | "CONFIRMED";
  exception_reason: string | null;
  exception_memo: string | null;
  procedures: AppointmentProcedureResponse[];
  verification_state: VerificationState;
  row_version: number;
};

export type AppointmentEventType =
  | "CREATED"
  | "UPDATED"
  | "CANCELLED"
  | "NO_SHOW"
  | "EXCEPTION_CONFIRMED";

export type AppointmentHistoryEvent = {
  id: string;
  event_type: AppointmentEventType;
  changed_fields: string[];
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown>;
  reason: string;
  actor_user_id: string;
  occurred_at: string;
};

/** 실제 예약에서 Backend가 바꿀 수 있는 항목만 담는다(환자 정보는 예약 변경 대상이 아니다). */
export type AppointmentChange = {
  serviceDate: string;
  startTime: string;
  careCategory: CareCategory;
  procedure: ProcedureKind;
  procedureSet: ProcedureSet;
  upperSedation: boolean;
  colonSedation: boolean;
};

type AppointmentListResponse = {
  items: AppointmentResponse[];
  total: number;
};

export type ScheduleAvailabilityResponse = {
  service_date: string;
  booking_bucket: BookingBucket;
  duration_minutes: number;
  procedure_set: ProcedureSetCode | null;
  schedule_policy_version: string;
  slots: Array<{
    start_time: string;
    end_time: string;
    slot_type?: "SAME_DAY_EXTENSION";
    additional_slot_id?: string | null;
  }>;
};

export type AdditionalSlotResponse = {
  id: string;
  service_date: string;
  start_time: string;
  end_time: string;
  reason: string;
  status: "APPROVED" | "REVOKED";
};

type PatientSummaryResponse = {
  id: string;
  chart_number: string;
  name: string;
  birth_date: string;
  sex: "MALE" | "FEMALE";
  is_active: boolean;
};

type PatientListResponse = {
  items: PatientSummaryResponse[];
};

type ProcedureSelection = Pick<
  BookingDraft,
  "procedure" | "upperSedation" | "colonSedation"
>;

export function proceduresFromDraft(draft: ProcedureSelection) {
  const procedures: Array<{
    procedure_code: ProcedureCode;
    sedation_mode: "SEDATED" | "NON_SEDATED";
  }> = [];
  if (draft.procedure === "위" || draft.procedure === "위·대장") {
    procedures.push({
      procedure_code: "UPPER",
      sedation_mode: draft.upperSedation ? "SEDATED" : "NON_SEDATED",
    });
  }
  if (draft.procedure === "대장" || draft.procedure === "위·대장") {
    procedures.push({
      procedure_code: "COLON",
      sedation_mode: draft.colonSedation ? "SEDATED" : "NON_SEDATED",
    });
  }
  return procedures;
}

export function procedureSetFromDraft(
  draft: Pick<BookingDraft, "procedure" | "procedureSet">,
): ProcedureSetCode | undefined {
  if (draft.procedure !== "위·대장") return undefined;
  return draft.procedureSet === "세트90" ? "SET_90" : "SET_60";
}

export function bookingCreateErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === "TIME_CONFLICT") {
    return "다른 사용자가 같은 시간을 먼저 예약했습니다. 가능 시간을 다시 조회했습니다.";
  }
  return error instanceof Error ? error.message : "예약을 저장하지 못했습니다.";
}

function procedureKind(procedures: AppointmentProcedureResponse[]): ProcedureKind {
  const codes = new Set(procedures.map((item) => item.procedure_code));
  if (codes.has("UPPER") && codes.has("COLON")) return "위·대장";
  return codes.has("COLON") ? "대장" : "위";
}

export function mapAppointmentResponse(item: AppointmentResponse): Appointment {
  const procedure = procedureKind(item.procedures);
  const upper = item.procedures.find((entry) => entry.procedure_code === "UPPER");
  const colon = item.procedures.find((entry) => entry.procedure_code === "COLON");
  return {
    id: item.id,
    date: item.service_date,
    start: item.start_time.slice(0, 5),
    duration: item.duration_minutes,
    name: item.patient_name,
    chartNumber: item.chart_number,
    dateOfBirth: item.birth_date,
    sex: item.sex === "FEMALE" ? "여" : "남",
    careCategory: item.care_type === "SCREENING" ? "검진" : "일반",
    procedure,
    procedureSet:
      procedure === "위·대장"
        ? item.procedure_set === "SET_90"
          ? "세트90"
          : "세트60"
        : undefined,
    upperSedation: upper?.sedation_mode === "SEDATED",
    colonSedation: colon?.sedation_mode === "SEDATED",
    deposit: "대기",
    medication: "대기",
    d1: "대기",
    // 인적사항 이중확인만 실제 값이다. 검사 준비 완료를 뜻하지 않는다.
    verification: item.verification_state === "VERIFIED" ? "완료" : "대기",
    pacs: "대기",
    status: "예약",
    afternoonException: item.booking_bucket === "AFTERNOON_EXCEPTION" || undefined,
    sameDay: item.booking_origin === "SAME_DAY" || undefined,
    sameDayExtension: item.booking_bucket === "SAME_DAY_EXTENSION" || undefined,
    additionalSlotId: item.additional_slot_id ?? undefined,
    sameDayReason: item.same_day_reason ?? undefined,
    sameDayPreparationConfirmed: item.same_day_preparation_confirmed,
    sameDayClinicianConfirmed: item.same_day_clinician_confirmed,
    sameDayEscortConfirmed: item.same_day_escort_confirmed,
    exceptionReason: item.exception_reason ?? undefined,
    memo:
      item.exception_memo ??
      "일정·예약 핵심정보만 Backend 연결됨. 확인·준비·수납은 정적 Prototype 영역입니다.",
    backendManaged: true,
    rowVersion: item.row_version,
    verificationState: item.verification_state,
    exceptionPending: item.exception_status === "PENDING" || undefined,
  };
}

export function bookingBucketOf(appointment: Appointment): BookingBucket {
  if (appointment.sameDayExtension) return "SAME_DAY_EXTENSION";
  if (appointment.afternoonException) return "AFTERNOON_EXCEPTION";
  return "STANDARD_MORNING";
}

export function appointmentChangeFrom(appointment: Appointment): AppointmentChange {
  return {
    serviceDate: appointment.date,
    startTime: appointment.start,
    careCategory: appointment.careCategory,
    procedure: appointment.procedure,
    procedureSet: appointment.procedureSet ?? "세트60",
    upperSedation: appointment.upperSedation ?? false,
    colonSedation: appointment.colonSedation ?? false,
  };
}

function requireRowVersion(appointment: Appointment): number {
  if (!appointment.backendManaged || appointment.rowVersion === undefined) {
    throw new ApiError(0, "Backend에 저장된 예약만 변경할 수 있습니다.");
  }
  return appointment.rowVersion;
}

function availabilityQuery(draft: BookingDraft) {
  const params = new URLSearchParams({
    service_date: draft.date,
    booking_bucket: draft.bucket,
    booking_origin: draft.bookingOrigin,
  });
  for (const procedure of proceduresFromDraft(draft)) {
    params.append("procedures", procedure.procedure_code);
  }
  const procedureSet = procedureSetFromDraft(draft);
  if (procedureSet) params.set("procedure_set", procedureSet);
  // 이미 고른 연장 Slot을 query에 넣으면 Backend가 목록을 그 Slot 하나로 좁혀
  // 승인된 다른 연장 Slot을 고를 수 없게 된다. 목록 조회에는 넣지 않는다.
  return params.toString();
}

export const appointmentsApi = {
  async list(startDate: string, endDate: string): Promise<Appointment[]> {
    const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
    const response = await apiRequest<AppointmentListResponse>(
      `/api/appointments?${params.toString()}`,
    );
    return response.items
      .filter((item) => item.workflow_state === "BOOKED")
      .map(mapAppointmentResponse);
  },

  availability(draft: BookingDraft) {
    return apiRequest<ScheduleAvailabilityResponse>(
      `/api/appointments/availability?${availabilityQuery(draft)}`,
    );
  },

  async findExactPatient(draft: BookingDraft): Promise<PatientSummaryResponse | null> {
    const params = new URLSearchParams({
      query: draft.chartNumber.trim(),
      birth_date: draft.dateOfBirth,
      sex: draft.sex === "여" ? "FEMALE" : "MALE",
      limit: "20",
    });
    const response = await apiRequest<PatientListResponse>(
      `/api/patients?${params.toString()}`,
    );
    const normalizedChart = draft.chartNumber.trim().toLocaleLowerCase();
    return (
      response.items.find(
        (patient) =>
          patient.is_active &&
          patient.chart_number.trim().toLocaleLowerCase() === normalizedChart &&
          patient.name.trim() === draft.name.trim() &&
          patient.birth_date === draft.dateOfBirth &&
          patient.sex === (draft.sex === "여" ? "FEMALE" : "MALE"),
      ) ?? null
    );
  },

  create(draft: BookingDraft, patientId: string, csrfToken: string) {
    return apiRequest<AppointmentResponse>("/api/appointments", {
      method: "POST",
      csrfToken,
      body: {
        patient_id: patientId,
        service_date: draft.date,
        start_time: draft.start,
        care_type: draft.careCategory === "검진" ? "SCREENING" : "GENERAL",
        booking_bucket: draft.bucket,
        booking_origin: draft.bookingOrigin,
        procedures: proceduresFromDraft(draft),
        procedure_set: procedureSetFromDraft(draft),
        exception_reason:
          draft.bucket === "AFTERNOON_EXCEPTION"
            ? draft.exceptionReason.trim()
            : undefined,
        additional_slot_id:
          draft.bucket === "SAME_DAY_EXTENSION" ? draft.additionalSlotId : undefined,
        same_day_reason:
          draft.bookingOrigin === "SAME_DAY" ? draft.sameDayReason.trim() : undefined,
        same_day_preparation_confirmed:
          draft.bookingOrigin === "SAME_DAY"
            ? draft.sameDayPreparationConfirmed
            : undefined,
        same_day_clinician_confirmed:
          draft.bookingOrigin === "SAME_DAY"
            ? draft.sameDayClinicianConfirmed
            : undefined,
        same_day_escort_confirmed:
          draft.bookingOrigin === "SAME_DAY"
            ? draft.sameDayEscortConfirmed
            : undefined,
      },
    });
  },

  /** 변경 중인 예약 자신은 점유·수용량 계산에서 뺀 가능 시간. */
  changeAvailability(appointment: Appointment, change: AppointmentChange) {
    const params = new URLSearchParams({
      service_date: change.serviceDate,
      booking_bucket: bookingBucketOf(appointment),
      booking_origin: appointment.sameDay ? "SAME_DAY" : "ADVANCE",
      exclude_appointment_id: appointment.id,
    });
    for (const procedure of proceduresFromDraft(change)) {
      params.append("procedures", procedure.procedure_code);
    }
    const procedureSet = procedureSetFromDraft(change);
    if (procedureSet) params.set("procedure_set", procedureSet);
    return apiRequest<ScheduleAvailabilityResponse>(
      `/api/appointments/availability?${params.toString()}`,
    );
  },

  async change(
    appointment: Appointment,
    change: AppointmentChange,
    reason: string,
    csrfToken: string,
  ) {
    return apiRequest<AppointmentResponse>(`/api/appointments/${appointment.id}`, {
      method: "PATCH",
      csrfToken,
      body: {
        row_version: requireRowVersion(appointment),
        reason: reason.trim(),
        service_date: change.serviceDate,
        start_time: change.startTime,
        care_type: change.careCategory === "검진" ? "SCREENING" : "GENERAL",
        procedures: proceduresFromDraft(change),
        procedure_set: procedureSetFromDraft(change),
      },
    });
  },

  async cancel(appointment: Appointment, reason: string, csrfToken: string) {
    return apiRequest<AppointmentResponse>(
      `/api/appointments/${appointment.id}/cancel`,
      {
        method: "POST",
        csrfToken,
        body: { row_version: requireRowVersion(appointment), reason: reason.trim() },
      },
    );
  },

  async noShow(appointment: Appointment, reason: string, csrfToken: string) {
    return apiRequest<AppointmentResponse>(
      `/api/appointments/${appointment.id}/no-show`,
      {
        method: "POST",
        csrfToken,
        body: { row_version: requireRowVersion(appointment), reason: reason.trim() },
      },
    );
  },

  async confirmException(appointment: Appointment, memo: string, csrfToken: string) {
    return apiRequest<AppointmentResponse>(
      `/api/appointments/${appointment.id}/confirm-exception`,
      {
        method: "POST",
        csrfToken,
        body: { row_version: requireRowVersion(appointment), memo: memo.trim() },
      },
    );
  },

  history(appointmentId: string) {
    return apiRequest<AppointmentHistoryEvent[]>(
      `/api/appointments/${appointmentId}/history`,
    );
  },

  createAdditionalSlot(
    serviceDate: string,
    startTime: string,
    reason: string,
    csrfToken: string,
  ) {
    return apiRequest<AdditionalSlotResponse>("/api/schedule/additional-slots", {
      method: "POST",
      csrfToken,
      body: {
        service_date: serviceDate,
        start_time: startTime,
        reason: reason.trim(),
      },
    });
  },
};
