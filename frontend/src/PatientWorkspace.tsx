import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type { AuthUser } from "./api";
import {
  patientApi,
  type PatientDetail,
  type PatientFormValues,
  type PatientHistoryEvent,
  type PatientSex,
  type PatientSummary,
  type PatientWarning,
} from "./patients";


const EMPTY_FORM: PatientFormValues = {
  chart_number: "",
  name: "",
  birth_date: "",
  sex: "FEMALE",
  phone: "",
  special_notes: "",
};

const HISTORY_LABELS: Record<PatientHistoryEvent["event_type"], string> = {
  CREATED: "신규 등록",
  UPDATED: "기본정보 변경",
  DEACTIVATED: "비활성화",
  REACTIVATED: "재활성화",
};

const FIELD_LABELS: Record<string, string> = {
  chart_number: "차트번호",
  name: "이름",
  birth_date: "생년월일",
  sex: "성별",
  phone: "연락처",
  special_notes: "특이사항",
  is_active: "활성 상태",
};

function sexLabel(sex: PatientSex) {
  return sex === "MALE" ? "남" : "여";
}

function ageSexLabel(patient: PatientSummary) {
  const agePrefix =
    patient.age_method === "SCREENING_YEAR_AGE" ? "검진" : "현재 만";
  return `${agePrefix} ${patient.age} · ${sexLabel(patient.sex)}`;
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function patientToForm(patient: PatientDetail): PatientFormValues {
  return {
    chart_number: patient.chart_number,
    name: patient.name,
    birth_date: patient.birth_date,
    sex: patient.sex,
    phone: patient.phone ?? "",
    special_notes: patient.special_notes ?? "",
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "요청을 처리하지 못했습니다. 다시 시도해 주세요.";
}

function PatientFormModal({
  mode,
  patient,
  csrfToken,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  patient: PatientDetail | null;
  csrfToken: string | null;
  onClose: () => void;
  onSaved: (
    patient: PatientDetail,
    warnings: PatientWarning[],
  ) => void;
}) {
  const [values, setValues] = useState<PatientFormValues>(
    patient ? patientToForm(patient) : EMPTY_FORM,
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [chartNotice, setChartNotice] = useState("");

  const updateField = <Key extends keyof PatientFormValues>(
    key: Key,
    value: PatientFormValues[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const checkChartNumber = async () => {
    if (!values.chart_number.trim()) {
      setChartNotice("");
      return;
    }
    try {
      const result = await patientApi.chartNumberAvailability(
        values.chart_number,
      );
      if (result.available || result.existing_patient_id === patient?.id) {
        setChartNotice("사용 가능한 차트번호입니다.");
      } else {
        setChartNotice(
          result.existing_patient_active
            ? "이미 등록된 차트번호입니다."
            : "비활성 환자가 사용 중인 차트번호입니다.",
        );
      }
    } catch (chartError) {
      setChartNotice(errorMessage(chartError));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !values.chart_number.trim() ||
      !values.name.trim() ||
      !values.birth_date
    ) {
      setError("차트번호·이름·생년월일·성별을 모두 확인해 주세요.");
      return;
    }
    if (mode === "edit" && reason.trim().length < 2) {
      setError("환자정보 변경 사유를 2자 이상 입력해 주세요.");
      return;
    }

    setPending(true);
    setError("");
    try {
      const response =
        mode === "create"
          ? await patientApi.create(values, csrfToken)
          : await patientApi.update(
              patient!.id,
              values,
              patient!.row_version,
              reason,
              csrfToken,
            );
      onSaved(response.patient, response.warnings);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="patient-modal" onSubmit={(event) => void submit(event)}>
        <header className="patient-modal__header">
          <div>
            <span className="eyebrow">
              {mode === "create" ? "PAT-001 신규 등록" : "PAT-001 정보 정정"}
            </span>
            <h2>{mode === "create" ? "환자 등록" : "환자정보 변경"}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </header>

        <div className="patient-modal__body">
          <div className="patient-form-note">
            이름만으로 판단하지 말고 차트번호·생년월일·성별을 함께 확인하세요.
          </div>
          <div className="form-grid form-grid--two">
            <label className="field">
              <span>차트번호 *</span>
              <input
                value={values.chart_number}
                maxLength={40}
                autoFocus
                onChange={(event) =>
                  updateField("chart_number", event.target.value)
                }
                onBlur={() => void checkChartNumber()}
                placeholder="앞자리 0을 포함해 그대로 입력"
              />
              {chartNotice ? (
                <small className="field-note">{chartNotice}</small>
              ) : null}
            </label>
            <label className="field">
              <span>이름 *</span>
              <input
                value={values.name}
                maxLength={100}
                onChange={(event) => updateField("name", event.target.value)}
              />
            </label>
            <label className="field">
              <span>생년월일 *</span>
              <input
                type="date"
                value={values.birth_date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) =>
                  updateField("birth_date", event.target.value)
                }
              />
            </label>
            <label className="field">
              <span>성별 *</span>
              <select
                value={values.sex}
                onChange={(event) =>
                  updateField("sex", event.target.value as PatientSex)
                }
              >
                <option value="FEMALE">여</option>
                <option value="MALE">남</option>
              </select>
            </label>
            <label className="field">
              <span>연락처</span>
              <input
                value={values.phone}
                maxLength={30}
                onChange={(event) => updateField("phone", event.target.value)}
                placeholder="선택 입력"
              />
            </label>
            <div className="patient-encryption-note">
              <strong>암호화 저장</strong>
              연락처와 특이사항은 목록에 노출하지 않고 상세 조회에서만
              표시합니다.
            </div>
          </div>
          <label className="field">
            <span>특이사항</span>
            <textarea
              rows={4}
              value={values.special_notes}
              maxLength={2000}
              onChange={(event) =>
                updateField("special_notes", event.target.value)
              }
              placeholder="예약 업무에 꼭 필요한 정보만 입력"
            />
          </label>
          {mode === "edit" ? (
            <label className="field">
              <span>변경 사유 *</span>
              <input
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="예: 접수 중 생년월일 재확인"
              />
            </label>
          ) : null}
          {error ? (
            <div className="inline-alert inline-alert--danger" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="patient-modal__footer">
          <span>실제 환자정보는 운영 Gate 완료 전 입력하지 마세요.</span>
          <div>
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={pending}
            >
              취소
            </button>
            <button className="primary-button" disabled={pending}>
              {pending ? "저장 중…" : mode === "create" ? "환자 등록" : "변경 저장"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function WarningBanner({
  warnings,
  onDismiss,
}: {
  warnings: PatientWarning[];
  onDismiss: () => void;
}) {
  if (warnings.length === 0) return null;
  return (
    <div className="patient-warning" role="alert">
      <div>
        <strong>중복 가능성 확인 필요</strong>
        <span>{warnings[0].message}</span>
        {warnings[0].candidates.map((candidate) => (
          <small key={candidate.id}>
            {candidate.name} · {candidate.chart_number} ·{" "}
            {candidate.birth_date} · {ageSexLabel(candidate)}
          </small>
        ))}
      </div>
      <button className="secondary-button" onClick={onDismiss}>
        확인
      </button>
    </div>
  );
}

function PatientDetailPanel({
  patient,
  history,
  loading,
  canUpdate,
  activationReason,
  onActivationReasonChange,
  onEdit,
  onActivation,
}: {
  patient: PatientDetail | null;
  history: PatientHistoryEvent[];
  loading: boolean;
  canUpdate: boolean;
  activationReason: string;
  onActivationReasonChange: (value: string) => void;
  onEdit: () => void;
  onActivation: () => void;
}) {
  if (loading) {
    return <aside className="patient-detail-panel">상세정보 확인 중…</aside>;
  }
  if (!patient) {
    return (
      <aside className="patient-detail-panel patient-detail-panel--empty">
        <strong>환자를 선택하세요</strong>
        <span>목록에서 환자를 선택하면 상세정보와 정정 History를 표시합니다.</span>
      </aside>
    );
  }

  return (
    <aside className="patient-detail-panel">
      <header>
        <div>
          <span className="eyebrow">Patient ID 이중확인</span>
          <h2>
            {patient.name}
            {!patient.is_active ? <em>비활성</em> : null}
          </h2>
          <p>
            {patient.chart_number} · {ageSexLabel(patient)}
          </p>
        </div>
        {canUpdate ? (
          <button className="secondary-button" onClick={onEdit}>
            정보 변경
          </button>
        ) : null}
      </header>

      <dl className="patient-detail-grid">
        <div>
          <dt>차트번호</dt>
          <dd>{patient.chart_number}</dd>
        </div>
        <div>
          <dt>생년월일</dt>
          <dd>{patient.birth_date}</dd>
        </div>
        <div>
          <dt>나이 · 성별</dt>
          <dd>{ageSexLabel(patient)}</dd>
        </div>
        <div>
          <dt>연락처</dt>
          <dd>{patient.phone ?? "미입력"}</dd>
        </div>
        <div className="patient-detail-grid__wide">
          <dt>특이사항</dt>
          <dd>{patient.special_notes ?? "없음"}</dd>
        </div>
      </dl>

      <div className="patient-risk-strip">
        <span>취소 {patient.cancellation_count}회</span>
        <span>No-show {patient.no_show_count}회</span>
        <strong>
          {patient.requires_booking_review
            ? "예약 제한 검토 대상"
            : "반복 취소 경고 없음"}
        </strong>
      </div>

      <section className="patient-history">
        <div className="section-heading">
          <h3>기본정보 변경 History</h3>
          <span>{history.length}건</span>
        </div>
        {history.map((event) => (
          <article key={event.id}>
            <span className={`history-mark history-mark--${event.event_type}`} />
            <div>
              <strong>{HISTORY_LABELS[event.event_type]}</strong>
              <p>
                {event.changed_fields
                  .map((field) => FIELD_LABELS[field] ?? field)
                  .join(" · ")}
              </p>
              <small>
                {dateTimeLabel(event.occurred_at)} ·{" "}
                {event.actor_display_name} · {event.reason}
              </small>
            </div>
          </article>
        ))}
      </section>

      <section className="patient-appointment-history">
        <h3>예약 History</h3>
        <p>
          Sprint 3 예약 API 연결 후 이 Patient ID에 귀속된 변경·취소·검사
          이력이 표시됩니다.
        </p>
      </section>

      {canUpdate ? (
        <div className="patient-activation">
          <label className="field">
            <span>
              {patient.is_active ? "비활성화 사유" : "재활성화 사유"}
            </span>
            <input
              value={activationReason}
              onChange={(event) =>
                onActivationReasonChange(event.target.value)
              }
              placeholder="삭제 대신 상태 변경 사유 입력"
            />
          </label>
          <button
            className={patient.is_active ? "danger-button" : "secondary-button"}
            onClick={onActivation}
            disabled={activationReason.trim().length < 2}
          >
            {patient.is_active ? "환자정보 비활성화" : "환자정보 재활성화"}
          </button>
        </div>
      ) : (
        <div className="read-only-notice">조회 권한으로 열었습니다.</div>
      )}
    </aside>
  );
}

export function PatientWorkspace({
  user,
  csrfToken,
  onNotify,
}: {
  user: AuthUser;
  csrfToken: string | null;
  onNotify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [sex, setSex] = useState<PatientSex | "">("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [history, setHistory] = useState<PatientHistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [warnings, setWarnings] = useState<PatientWarning[]>([]);
  const [activationReason, setActivationReason] = useState("");

  const canCreate =
    user.permissions.includes("*") ||
    user.permissions.includes("patient.create");
  const canUpdate =
    user.permissions.includes("*") ||
    user.permissions.includes("patient.update");

  const searchParams = useMemo(
    () => ({
      query,
      birthDate,
      sex,
      includeInactive,
    }),
    [birthDate, includeInactive, query, sex],
  );

  const loadPatients = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await patientApi.search(searchParams);
      setPatients(response.items);
      setTotal(response.total);
      setSelectedId((current) =>
        response.items.some((patient) => patient.id === current)
          ? current
          : (response.items[0]?.id ?? null),
      );
      if (response.items.length === 0) {
        setSelectedId(null);
        setDetail(null);
        setHistory([]);
      }
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  const loadDetail = useCallback(async (patientId: string) => {
    setDetailLoading(true);
    setActivationReason("");
    try {
      const [patient, events] = await Promise.all([
        patientApi.get(patientId),
        patientApi.history(patientId),
      ]);
      setDetail(patient);
      setHistory(events);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPatients(), 250);
    return () => window.clearTimeout(timer);
  }, [loadPatients]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  const handleSaved = (
    savedPatient: PatientDetail,
    responseWarnings: PatientWarning[],
  ) => {
    setModal(null);
    setSelectedId(savedPatient.id);
    setDetail(savedPatient);
    setWarnings(responseWarnings);
    onNotify(
      responseWarnings.length
        ? "저장했습니다. 동명이인 가능성을 확인해 주세요."
        : "환자정보를 안전하게 저장했습니다.",
    );
    void loadPatients();
    void loadDetail(savedPatient.id);
  };

  const changeActivation = async () => {
    if (!detail || activationReason.trim().length < 2) return;
    try {
      const response = await patientApi.setActivation(
        detail.id,
        detail.row_version,
        !detail.is_active,
        activationReason,
        csrfToken,
      );
      setDetail(response.patient);
      setActivationReason("");
      onNotify(
        response.patient.is_active
          ? "환자정보를 재활성화했습니다."
          : "환자정보를 삭제하지 않고 비활성화했습니다.",
      );
      void loadPatients();
      void loadDetail(response.patient.id);
    } catch (activationError) {
      setError(errorMessage(activationError));
    }
  };

  return (
    <section className="view-surface patient-workspace">
      <div className="view-title">
        <div>
          <span className="eyebrow">PAT-001 · PAT-002</span>
          <h1>환자 검색·History</h1>
          <p>
            차트번호·이름·생년월일·성별을 함께 확인하고 정정 이력을
            보존합니다.
          </p>
        </div>
        {canCreate ? (
          <button className="primary-button" onClick={() => setModal("create")}>
            + 신규 환자
          </button>
        ) : null}
      </div>

      <WarningBanner warnings={warnings} onDismiss={() => setWarnings([])} />

      <div className="patient-search-panel">
        <label className="patient-search-input">
          <span>이름 또는 차트번호</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="검색어 입력"
          />
        </label>
        <label>
          <span>생년월일</span>
          <input
            type="date"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
          />
        </label>
        <label>
          <span>성별</span>
          <select
            value={sex}
            onChange={(event) =>
              setSex(event.target.value as PatientSex | "")
            }
          >
            <option value="">전체</option>
            <option value="FEMALE">여</option>
            <option value="MALE">남</option>
          </select>
        </label>
        {canUpdate ? (
          <label className="patient-check-filter">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
            />
            비활성 포함
          </label>
        ) : null}
        <button className="secondary-button" onClick={() => void loadPatients()}>
          새로고침
        </button>
      </div>

      {error ? (
        <div className="inline-alert inline-alert--danger" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>닫기</button>
        </div>
      ) : null}

      <div className="patient-workspace__content">
        <div className="table-card patient-list-card">
          <div className="patient-list-summary">
            <strong>검색 결과 {total}명</strong>
            <span>목록에는 연락처·특이사항을 표시하지 않습니다.</span>
          </div>
          <div className="data-table data-table--patient-api">
            <div className="data-table__head">
              <span>환자</span>
              <span>차트번호</span>
              <span>생년월일</span>
              <span>나이 · 성별</span>
              <span>취소 / No-show</span>
              <span>상태</span>
            </div>
            {loading ? (
              <div className="patient-list-empty">검색 중…</div>
            ) : patients.length === 0 ? (
              <div className="patient-list-empty">
                조건에 맞는 환자가 없습니다.
              </div>
            ) : (
              patients.map((patient) => (
                <button
                  type="button"
                  className={`data-table__row ${
                    selectedId === patient.id ? "is-selected" : ""
                  }`}
                  key={patient.id}
                  onClick={() => setSelectedId(patient.id)}
                >
                  <span>
                    <strong>{patient.name}</strong>
                  </span>
                  <span>{patient.chart_number}</span>
                  <span>{patient.birth_date}</span>
                  <span>{ageSexLabel(patient)}</span>
                  <span>
                    {patient.cancellation_count} / {patient.no_show_count}
                  </span>
                  <span>
                    <em
                      className={
                        patient.is_active
                          ? "patient-state patient-state--active"
                          : "patient-state patient-state--inactive"
                      }
                    >
                      {patient.is_active ? "사용 중" : "비활성"}
                    </em>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <PatientDetailPanel
          patient={detail}
          history={history}
          loading={detailLoading}
          canUpdate={canUpdate}
          activationReason={activationReason}
          onActivationReasonChange={setActivationReason}
          onEdit={() => setModal("edit")}
          onActivation={() => void changeActivation()}
        />
      </div>

      {modal ? (
        <PatientFormModal
          mode={modal}
          patient={modal === "edit" ? detail : null}
          csrfToken={csrfToken}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </section>
  );
}
