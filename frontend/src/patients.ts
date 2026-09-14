import { apiRequest } from "./api";

export type PatientSex = "MALE" | "FEMALE";
export type AgeMethod = "FULL_AGE" | "SCREENING_YEAR_AGE";

export type PatientSummary = {
  id: string;
  chart_number: string;
  name: string;
  birth_date: string;
  sex: PatientSex;
  age: number;
  age_method: AgeMethod;
  age_reference_date: string;
  cancellation_count: number;
  no_show_count: number;
  requires_booking_review: boolean;
  is_active: boolean;
  row_version: number;
};

export type PatientDetail = PatientSummary & {
  phone: string | null;
  special_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientHistoryEvent = {
  id: string;
  event_type: "CREATED" | "UPDATED" | "DEACTIVATED" | "REACTIVATED";
  changed_fields: string[];
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown>;
  reason: string;
  actor_user_id: string;
  actor_display_name: string;
  occurred_at: string;
};

export type PatientListResponse = {
  items: PatientSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type PatientWarning = {
  code: string;
  message: string;
  candidates: PatientSummary[];
};

export type PatientMutationResponse = {
  patient: PatientDetail;
  warnings: PatientWarning[];
};

export type PatientFormValues = {
  chart_number: string;
  name: string;
  birth_date: string;
  sex: PatientSex;
  phone: string;
  special_notes: string;
};

export type PatientSearchParams = {
  query?: string;
  birthDate?: string;
  sex?: PatientSex | "";
  includeInactive?: boolean;
};

function toQueryString(params: PatientSearchParams) {
  const query = new URLSearchParams();
  if (params.query?.trim()) query.set("query", params.query.trim());
  if (params.birthDate) query.set("birth_date", params.birthDate);
  if (params.sex) query.set("sex", params.sex);
  if (params.includeInactive) query.set("include_inactive", "true");
  query.set("limit", "100");
  return query.toString();
}

export const patientApi = {
  search(params: PatientSearchParams) {
    return apiRequest<PatientListResponse>(
      `/api/patients?${toQueryString(params)}`,
    );
  },

  get(patientId: string) {
    return apiRequest<PatientDetail>(`/api/patients/${patientId}`);
  },

  history(patientId: string) {
    return apiRequest<PatientHistoryEvent[]>(
      `/api/patients/${patientId}/history`,
    );
  },

  chartNumberAvailability(chartNumber: string) {
    const query = new URLSearchParams({ chart_number: chartNumber });
    return apiRequest<{
      chart_number: string;
      normalized_chart_number: string;
      available: boolean;
      existing_patient_id: string | null;
      existing_patient_active: boolean | null;
    }>(`/api/patients/chart-number-availability?${query}`);
  },

  create(
    values: PatientFormValues,
    csrfToken: string | null,
  ) {
    return apiRequest<PatientMutationResponse>("/api/patients", {
      method: "POST",
      csrfToken,
      body: {
        ...values,
        phone: values.phone.trim() || null,
        special_notes: values.special_notes.trim() || null,
      },
    });
  },

  update(
    patientId: string,
    values: PatientFormValues,
    rowVersion: number,
    reason: string,
    csrfToken: string | null,
  ) {
    return apiRequest<PatientMutationResponse>(
      `/api/patients/${patientId}`,
      {
        method: "PATCH",
        csrfToken,
        body: {
          ...values,
          phone: values.phone.trim() || null,
          special_notes: values.special_notes.trim() || null,
          row_version: rowVersion,
          reason,
        },
      },
    );
  },

  setActivation(
    patientId: string,
    rowVersion: number,
    isActive: boolean,
    reason: string,
    csrfToken: string | null,
  ) {
    return apiRequest<PatientMutationResponse>(
      `/api/patients/${patientId}/activation`,
      {
        method: "PATCH",
        csrfToken,
        body: {
          row_version: rowVersion,
          is_active: isActive,
          reason,
        },
      },
    );
  },
};
