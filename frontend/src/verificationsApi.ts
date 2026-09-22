import { ApiError, apiRequest } from "./api.ts";

export type VerificationStage = "PRIMARY" | "SECONDARY";
export type VerificationMethod = "IN_PERSON" | "ID_DOCUMENT" | "PHONE" | "CHART_RECORD";
export type VerificationState =
  | "UNVERIFIED"
  | "PRIMARY_DONE"
  | "VERIFIED"
  | "REVERIFY_REQUIRED";
export type InvalidationType = "CORE_CHANGED" | "CORRECTED";

export type VerificationSubject = {
  name: string;
  chart_number: string;
  birth_date: string;
  sex: "MALE" | "FEMALE";
  service_date: string;
  start_time: string;
  procedures: Array<{
    procedure_code: "UPPER" | "COLON";
    sedation_mode: "SEDATED" | "NON_SEDATED";
  }>;
  procedure_set: "SET_60" | "SET_90" | null;
  care_type: "GENERAL" | "SCREENING";
  computed_age: number;
  age_method: "FULL_AGE" | "SCREENING_YEAR_AGE";
  age_reference_date: string;
};

export type VerificationRecord = {
  id: string;
  stage: VerificationStage;
  is_valid: boolean;
  method: VerificationMethod;
  memo: string | null;
  verified_by_user_id: string;
  verified_by_name: string;
  verified_at: string;
  appointment_row_version: number;
  subject: VerificationSubject;
  invalidated_at: string | null;
  invalidated_by_user_id: string | null;
  invalidated_by_name: string | null;
  invalidation_type: InvalidationType | null;
  invalidation_reason: string | null;
};

export type VerificationStatus = {
  appointment_id: string;
  workflow_state: "BOOKED" | "CANCELLED" | "NO_SHOW";
  state: VerificationState;
  fingerprint: string;
  current: VerificationSubject;
  primary: VerificationRecord | null;
  secondary: VerificationRecord | null;
  last_invalidation: VerificationRecord | null;
  history: VerificationRecord[];
};

// "이중확인 완료"는 인적사항 확인만 뜻한다. 검사 준비 완료로 표시하지 않는다.
export const VERIFICATION_STATE_LABELS: Record<VerificationState, string> = {
  UNVERIFIED: "1차 확인 대기",
  PRIMARY_DONE: "2차 확인 대기",
  VERIFIED: "이중확인 완료",
  REVERIFY_REQUIRED: "재확인 필요",
};

export const METHOD_LABELS: Record<VerificationMethod, string> = {
  IN_PERSON: "대면 문답",
  ID_DOCUMENT: "신분증 대조",
  PHONE: "전화 확인",
  CHART_RECORD: "차트·검진기록 대조",
};

export const INVALIDATION_LABELS: Record<InvalidationType, string> = {
  CORE_CHANGED: "핵심정보 변경으로 무효",
  CORRECTED: "2차 확인 정정",
};

// 이 오류는 화면이 들고 있던 확인 상태가 낡았다는 뜻이라 최신 상태를 다시 받는다.
const RELOAD_CODES = new Set([
  "VERIFICATION_STALE",
  "VERIFICATION_ALREADY_DONE",
  "PRIMARY_VERIFICATION_REQUIRED",
  "APPOINTMENT_NOT_ACTIVE",
]);

export function verificationNeedsReload(error: unknown): boolean {
  return error instanceof ApiError && error.code !== null && RELOAD_CODES.has(error.code);
}

/** 권한 부족·동일인 2차 확인·정보 변경 충돌을 직원이 바로 이해할 한국어로 바꾼다. */
export function verificationErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : "확인을 저장하지 못했습니다.";
  }
  if (error.code === "PERMISSION_DENIED") {
    return "이 단계의 확인 권한이 없습니다. 권한이 있는 직원에게 요청해 주세요.";
  }
  if (error.code === "SECOND_REVIEWER_INVALID") {
    return "1차 확인자와 다른 직원이 2차 확인해야 합니다. 다른 계정으로 로그인한 직원이 확인해 주세요.";
  }
  if (error.code === "VERIFICATION_STALE") {
    return "화면을 연 뒤 환자·검사 정보가 바뀌었습니다. 최신 정보를 다시 불러왔으니 확인한 뒤 다시 진행해 주세요.";
  }
  return error.message;
}

export const verificationsApi = {
  status(appointmentId: string) {
    return apiRequest<VerificationStatus>(`/api/appointments/${appointmentId}/verifications`);
  },

  verify(
    appointmentId: string,
    stage: VerificationStage,
    fingerprint: string,
    method: VerificationMethod,
    memo: string,
    csrfToken: string,
  ) {
    return apiRequest<VerificationStatus>(
      `/api/appointments/${appointmentId}/verifications/${stage === "PRIMARY" ? "primary" : "secondary"}`,
      {
        method: "POST",
        csrfToken,
        body: {
          expected_fingerprint: fingerprint,
          method,
          memo: memo.trim() || undefined,
        },
      },
    );
  },

  correctSecondary(
    appointmentId: string,
    verificationId: string,
    reason: string,
    csrfToken: string,
  ) {
    return apiRequest<VerificationStatus>(
      `/api/appointments/${appointmentId}/verifications/secondary/correct`,
      {
        method: "POST",
        csrfToken,
        body: { verification_id: verificationId, reason: reason.trim() },
      },
    );
  },
};
