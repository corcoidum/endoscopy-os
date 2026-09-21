import { apiRequest } from "./api.ts";

export type OverrideRuleType = "CLOSED" | "OPERATING_HOURS" | "CAPACITY" | "AFTERNOON_ALLOW";
export type OverrideStatus = "PENDING" | "APPROVED" | "REVOKED" | "SUPERSEDED";
export type PolicyConflictIssue =
  | "CLOSED"
  | "OUTSIDE_OPERATING_HOURS"
  | "CAPACITY_EXCEEDED"
  | "AFTERNOON_NOT_ALLOWED";

export type ScheduleOverride = {
  id: string;
  service_date: string;
  rule_type: OverrideRuleType;
  override_start_time: string | null;
  override_end_time: string | null;
  override_upper_capacity: number | null;
  override_colon_capacity: number | null;
  reason: string;
  status: OverrideStatus;
  requested_by_user_id: string;
  approved_by_user_id: string | null;
  approved_at: string | null;
  revoked_by_user_id: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  superseded_by_id: string | null;
  created_at: string;
};

export type ImpactedAppointment = {
  id: string;
  start_time: string;
  end_time: string;
  booking_bucket: string;
  procedures: Array<"UPPER" | "COLON">;
  issue: PolicyConflictIssue;
};

export type OverrideDecision = {
  override: ScheduleOverride;
  impacted_appointments: ImpactedAppointment[];
};

/** 화면 입력값. 규칙 종류에 필요 없는 값은 보내지 않는다. */
export type OverrideDraft = {
  serviceDate: string;
  ruleType: OverrideRuleType;
  startTime: string;
  endTime: string;
  upperCapacity: string;
  colonCapacity: string;
  reason: string;
};

export const RULE_TYPE_LABELS: Record<OverrideRuleType, string> = {
  CLOSED: "휴진",
  OPERATING_HOURS: "운영시간 변경",
  CAPACITY: "수용량 변경",
  AFTERNOON_ALLOW: "14:00 오후 예외 허용",
};

export const STATUS_LABELS: Record<OverrideStatus, string> = {
  PENDING: "승인 대기",
  APPROVED: "승인됨",
  REVOKED: "취소됨",
  SUPERSEDED: "대체됨",
};

export const ISSUE_LABELS: Record<PolicyConflictIssue, string> = {
  CLOSED: "휴진일과 겹침",
  OUTSIDE_OPERATING_HOURS: "운영시간 밖",
  CAPACITY_EXCEEDED: "수용량 초과",
  AFTERNOON_NOT_ALLOWED: "오후 예외 불허",
};

function capacity(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

export function overrideRequestBody(draft: OverrideDraft) {
  const body: Record<string, unknown> = {
    service_date: draft.serviceDate,
    rule_type: draft.ruleType,
    reason: draft.reason.trim(),
  };
  if (draft.ruleType === "OPERATING_HOURS") {
    body.override_start_time = draft.startTime;
    body.override_end_time = draft.endTime;
  }
  if (draft.ruleType === "CAPACITY") {
    const upper = capacity(draft.upperCapacity);
    const colon = capacity(draft.colonCapacity);
    if (upper !== undefined) body.override_upper_capacity = upper;
    if (colon !== undefined) body.override_colon_capacity = colon;
  }
  return body;
}

/** "09:00~11:00", "위 3 · 대장 2"처럼 규칙 값을 한 줄로 요약한다. */
export function overrideDetail(override: ScheduleOverride): string {
  if (override.rule_type === "OPERATING_HOURS") {
    return `${override.override_start_time?.slice(0, 5) ?? "?"}~${override.override_end_time?.slice(0, 5) ?? "?"}`;
  }
  if (override.rule_type === "CAPACITY") {
    const parts: string[] = [];
    if (override.override_upper_capacity !== null) {
      parts.push(`위 ${override.override_upper_capacity}`);
    }
    if (override.override_colon_capacity !== null) {
      parts.push(`대장 ${override.override_colon_capacity}`);
    }
    return parts.join(" · ");
  }
  return "";
}

export const scheduleOverridesApi = {
  list(startDate: string, endDate: string) {
    const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return apiRequest<ScheduleOverride[]>(`/api/schedule/overrides?${params.toString()}`);
  },

  create(draft: OverrideDraft, csrfToken: string) {
    return apiRequest<ScheduleOverride>("/api/schedule/overrides", {
      method: "POST",
      csrfToken,
      body: overrideRequestBody(draft),
    });
  },

  approve(overrideId: string, csrfToken: string) {
    return apiRequest<OverrideDecision>(`/api/schedule/overrides/${overrideId}/approve`, {
      method: "POST",
      csrfToken,
    });
  },

  revoke(overrideId: string, reason: string, csrfToken: string) {
    return apiRequest<OverrideDecision>(`/api/schedule/overrides/${overrideId}/revoke`, {
      method: "POST",
      csrfToken,
      body: { reason: reason.trim() },
    });
  },
};
