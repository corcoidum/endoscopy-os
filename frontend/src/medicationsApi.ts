import { ApiError, apiRequest } from "./api.ts";

export type MedicationState =
  | "NOT_REQUIRED"
  | "CHECK_REQUIRED"
  | "PHYSICIAN_REQUIRED"
  | "RE_REVIEW_REQUIRED"
  | "NOTIFICATION_REQUIRED"
  | "COMPLETE";
export type MedicationStatus = "UNCHECKED" | "LIST_CONFIRMED" | "NONE_CONFIRMED";
export type MedicationDecision = "HOLD" | "CONTINUE";
export type MedicationCategoryKey =
  | "anticoagulant"
  | "antiplatelet"
  | "circulation"
  | "cardiac"
  | "neurologic"
  | "chronic_disease";
export type MedicationCategories = Record<MedicationCategoryKey, boolean>;

export type PhysicianProfile = { id: string; display_name: string };

export type MedicationChecklistSnapshot = {
  medication_status: MedicationStatus;
  medication_list: string | null;
  categories: MedicationCategories;
  surgery_history: string | null;
  cardiovascular_history: string | null;
  emr_recorded: boolean;
};

export type MedicationChecklist = MedicationChecklistSnapshot & {
  confirmed_by_user_id: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  updated_by_name: string | null;
  updated_at: string;
  row_version: number;
};

export type MedicationItem = {
  id: string;
  item_key: string;
  revision: number;
  status: "ACTIVE" | "SUPERSEDED" | "WITHDRAWN";
  medication_name: string;
  decision: "PENDING" | MedicationDecision;
  hold_days: number | null;
  rationale: string | null;
  physician_profile_id: string | null;
  physician_name: string | null;
  decided_for_service_date: string | null;
  needs_re_review: boolean;
  recorded_by_user_id: string;
  recorded_by_name: string | null;
  recorded_at: string;
  patient_notified_at: string | null;
  patient_notified_by_name: string | null;
  hold_confirmed_on: string | null;
  hold_confirmed_at: string | null;
  hold_confirmed_by_name: string | null;
  ended_at: string | null;
  ended_by_name: string | null;
  end_reason: string | null;
};

export type MedicationReview = {
  appointment_id: string;
  workflow_state: "BOOKED" | "CANCELLED" | "NO_SHOW";
  service_date: string;
  has_colon: boolean;
  state: MedicationState;
  checklist: MedicationChecklist | null;
  items: MedicationItem[];
  item_history: MedicationItem[];
  checklist_history: Array<{
    revision: number;
    snapshot: MedicationChecklistSnapshot;
    saved_by_name: string | null;
    saved_at: string;
  }>;
  physicians: PhysicianProfile[];
};

// "약제 확인 완료"는 복용약 확인과 의사 결정 안내까지만 뜻한다. 검사 준비 완료가 아니다.
export const MEDICATION_STATE_LABELS: Record<MedicationState, string> = {
  NOT_REQUIRED: "약제 확인 대상 아님",
  CHECK_REQUIRED: "약제 확인 필요",
  PHYSICIAN_REQUIRED: "의사 확인 필요",
  RE_REVIEW_REQUIRED: "약제 재검토 필요",
  NOTIFICATION_REQUIRED: "환자 안내 필요",
  COMPLETE: "약제 확인 완료",
};

export const MEDICATION_STATE_TONES: Record<MedicationState, "neutral" | "warning" | "danger" | "success"> = {
  NOT_REQUIRED: "neutral",
  CHECK_REQUIRED: "warning",
  PHYSICIAN_REQUIRED: "danger",
  RE_REVIEW_REQUIRED: "danger",
  NOTIFICATION_REQUIRED: "warning",
  COMPLETE: "success",
};

// 확인 업무 목록에서 먼저 처리할 순서.
export const MEDICATION_QUEUE_ORDER: MedicationState[] = [
  "RE_REVIEW_REQUIRED",
  "PHYSICIAN_REQUIRED",
  "CHECK_REQUIRED",
  "NOTIFICATION_REQUIRED",
];

export const MEDICATION_STATUS_LABELS: Record<MedicationStatus, string> = {
  UNCHECKED: "아직 확인 전",
  LIST_CONFIRMED: "복용약 목록 확인",
  NONE_CONFIRMED: "복용약 없음 확인",
};

export const MEDICATION_CATEGORY_LABELS: Record<MedicationCategoryKey, string> = {
  anticoagulant: "항응고제",
  antiplatelet: "항혈소판제",
  circulation: "혈액순환제",
  cardiac: "심장약",
  neurologic: "신경계 약",
  chronic_disease: "만성질환 약",
};

export const MEDICATION_CATEGORY_KEYS = Object.keys(
  MEDICATION_CATEGORY_LABELS,
) as MedicationCategoryKey[];

export const MEDICATION_SAFETY_NOTICE = "약제 중단 여부는 담당 의사의 확인이 필요합니다.";

export function emptyMedicationCategories(): MedicationCategories {
  return {
    anticoagulant: false,
    antiplatelet: false,
    circulation: false,
    cardiac: false,
    neurologic: false,
    chronic_disease: false,
  };
}

/** 주간 카드의 약제 표시. 연결된 실제 상태를 세 단계로 줄인다. */
export function medicationCheckState(state: MedicationState | undefined): "완료" | "대기" | "불필요" {
  if (!state || state === "NOT_REQUIRED") return "불필요";
  return state === "COMPLETE" ? "완료" : "대기";
}

/**
 * 원장 1인 운영이라 의사 선택기를 두지 않는다. 활성 의사 Profile이 정확히 한 명일 때만
 * 그 Profile을 결정 주체로 쓰고, 아니면 관리자 설정 안내를 돌려준다.
 */
export function solePhysician(physicians: PhysicianProfile[]): {
  physician: PhysicianProfile | null;
  problem: string | null;
} {
  if (physicians.length === 1) return { physician: physicians[0], problem: null };
  return {
    physician: null,
    problem:
      physicians.length === 0
        ? "관리자 화면에서 담당 의사 Profile을 먼저 등록해야 의사 결정을 기록할 수 있습니다."
        : "활성 의사 Profile이 여러 명입니다. 관리자 화면에서 결정을 기록할 의사 한 명만 활성으로 두세요.",
  };
}

export type ChecklistBody = {
  medication_status: MedicationStatus;
  medication_list?: string;
  categories: MedicationCategories;
  surgery_history?: string;
  cardiovascular_history?: string;
  emr_recorded: boolean;
};

export type DecisionBody = {
  decision: MedicationDecision;
  hold_days?: number;
  rationale?: string;
  physician_profile_id: string;
  physician_confirmed: boolean;
};

export function checklistBody(input: {
  status: MedicationStatus;
  medicationList: string;
  categories: MedicationCategories;
  surgeryHistory: string;
  cardiovascularHistory: string;
  emrRecorded: boolean;
}): ChecklistBody {
  const none = input.status === "NONE_CONFIRMED";
  return {
    medication_status: input.status,
    medication_list: input.medicationList.trim() || undefined,
    // '복용약 없음'이면 복용 분류를 보내지 않는다.
    categories: none ? emptyMedicationCategories() : input.categories,
    surgery_history: input.surgeryHistory.trim() || undefined,
    cardiovascular_history: input.cardiovascularHistory.trim() || undefined,
    emr_recorded: input.emrRecorded,
  };
}

export function decisionBody(
  input: {
    decision: MedicationDecision;
    holdDays: string;
    rationale: string;
    physicianConfirmed: boolean;
  },
  physicianId: string,
): DecisionBody {
  return {
    decision: input.decision,
    hold_days: input.decision === "HOLD" ? Number(input.holdDays) : undefined,
    rationale: input.rationale.trim() || undefined,
    physician_profile_id: physicianId,
    physician_confirmed: input.physicianConfirmed,
  };
}

export type WizardMedicationDraft = {
  medicationsChecked: boolean;
  medicationNone: boolean;
  medicationListMemo: string;
  medicationCategories: MedicationCategories;
  medicationDiscontinuations: Array<{
    medicationName: string;
    discontinuationDays: string;
    doctorConfirmed: boolean;
  }>;
};

/** 예약 등록 5단계의 입력이 비어 있는지. 비었으면 대장내시경이 없을 때 저장하지 않는다. */
export function wizardMedicationTouched(draft: WizardMedicationDraft): boolean {
  return (
    draft.medicationsChecked ||
    draft.medicationNone ||
    Boolean(draft.medicationListMemo.trim()) ||
    Object.values(draft.medicationCategories).some(Boolean) ||
    draft.medicationDiscontinuations.some(
      (row) => row.medicationName.trim() || row.discontinuationDays.trim() || row.doctorConfirmed,
    )
  );
}

/** 예약 등록 5단계 입력을 Backend 요청으로 바꾼다. 의사 결정 행은 모두 확인된 행만 온다. */
export function wizardMedicationRequests(
  draft: WizardMedicationDraft,
  physicianId: string | null,
): { checklist: ChecklistBody; items: Array<{ medication_name: string; decision: DecisionBody }> } {
  const status: MedicationStatus = draft.medicationNone
    ? "NONE_CONFIRMED"
    : draft.medicationsChecked
      ? "LIST_CONFIRMED"
      : "UNCHECKED";
  const rows = draft.medicationNone
    ? []
    : draft.medicationDiscontinuations.filter(
        (row) => row.medicationName.trim() && row.discontinuationDays.trim(),
      );
  if (rows.length > 0 && !physicianId) {
    throw new Error("의사 결정을 기록할 의사 Profile이 없습니다.");
  }
  return {
    checklist: checklistBody({
      status,
      medicationList: draft.medicationListMemo,
      categories: draft.medicationCategories,
      surgeryHistory: "",
      cardiovascularHistory: "",
      emrRecorded: false,
    }),
    items: rows.map((row) => ({
      medication_name: row.medicationName.trim(),
      decision: decisionBody(
        {
          decision: "HOLD",
          holdDays: row.discontinuationDays,
          rationale: "",
          physicianConfirmed: row.doctorConfirmed,
        },
        physicianId ?? "",
      ),
    })),
  };
}

// 화면이 들고 있던 복용약 기록이 낡았다는 뜻이라 최신 내용을 다시 받는다.
const RELOAD_CODES = new Set([
  "MEDICATION_REVIEW_STALE",
  "MEDICATION_ITEM_STALE",
  "MEDICATION_RE_REVIEW_REQUIRED",
  "MEDICATION_CHECKLIST_REQUIRED",
  "APPOINTMENT_NOT_ACTIVE",
]);

export function medicationNeedsReload(error: unknown): boolean {
  return error instanceof ApiError && error.code !== null && RELOAD_CODES.has(error.code);
}

export function medicationErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : "복용약 기록을 저장하지 못했습니다.";
  }
  if (error.code === "PERMISSION_DENIED") {
    return "이 작업을 할 권한이 없습니다. 권한이 있는 직원에게 요청해 주세요.";
  }
  if (error.code === "VALIDATION_ERROR") {
    return "입력한 값을 다시 확인해 주세요. 중단 일수는 1~90일이어야 합니다.";
  }
  return error.message;
}

type ItemRef = Pick<MedicationItem, "item_key" | "revision">;

function reviewPath(appointmentId: string, suffix = "") {
  return `/api/appointments/${appointmentId}/medication-review${suffix}`;
}

export const medicationsApi = {
  review(appointmentId: string) {
    return apiRequest<MedicationReview>(reviewPath(appointmentId));
  },

  saveChecklist(
    appointmentId: string,
    body: ChecklistBody,
    expectedRowVersion: number | null,
    csrfToken: string,
  ) {
    return apiRequest<MedicationReview>(reviewPath(appointmentId, "/checklist"), {
      method: "PUT",
      csrfToken,
      body: { ...body, expected_row_version: expectedRowVersion ?? undefined },
    });
  },

  addItem(
    appointmentId: string,
    medicationName: string,
    decision: DecisionBody | null,
    csrfToken: string,
  ) {
    return apiRequest<MedicationReview>(reviewPath(appointmentId, "/items"), {
      method: "POST",
      csrfToken,
      body: { medication_name: medicationName.trim(), decision: decision ?? undefined },
    });
  },

  decide(appointmentId: string, item: ItemRef, decision: DecisionBody, csrfToken: string) {
    return apiRequest<MedicationReview>(
      reviewPath(appointmentId, `/items/${item.item_key}/decision`),
      {
        method: "POST",
        csrfToken,
        body: { ...decision, expected_revision: item.revision },
      },
    );
  },

  withdraw(appointmentId: string, item: ItemRef, reason: string, csrfToken: string) {
    return apiRequest<MedicationReview>(
      reviewPath(appointmentId, `/items/${item.item_key}/withdraw`),
      {
        method: "POST",
        csrfToken,
        body: { expected_revision: item.revision, reason: reason.trim() },
      },
    );
  },

  notify(appointmentId: string, item: ItemRef, csrfToken: string) {
    return apiRequest<MedicationReview>(
      reviewPath(appointmentId, `/items/${item.item_key}/notify`),
      { method: "POST", csrfToken, body: { expected_revision: item.revision } },
    );
  },

  confirmHold(appointmentId: string, item: ItemRef, confirmedOn: string, csrfToken: string) {
    return apiRequest<MedicationReview>(
      reviewPath(appointmentId, `/items/${item.item_key}/hold-confirmation`),
      {
        method: "POST",
        csrfToken,
        body: { expected_revision: item.revision, confirmed_on: confirmedOn },
      },
    );
  },

  async physicians() {
    const response = await apiRequest<{ items: PhysicianProfile[] }>(
      "/api/staff-profiles/physicians",
    );
    return response.items;
  },
};
