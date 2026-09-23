import { useEffect, useState } from "react";
import { formatSeoulDateTime } from "./appointmentPresentation";
import { seoulTodayIso } from "./calendarDates";
import { Icon } from "./icons";
import {
  MEDICATION_CATEGORY_KEYS,
  MEDICATION_CATEGORY_LABELS,
  MEDICATION_SAFETY_NOTICE,
  MEDICATION_STATE_LABELS,
  MEDICATION_STATE_TONES,
  MEDICATION_STATUS_LABELS,
  checklistBody,
  decisionBody,
  medicationErrorMessage,
  medicationNeedsReload,
  medicationsApi,
  solePhysician,
  type MedicationCategories,
  type MedicationChecklist,
  type MedicationDecision,
  type MedicationItem,
  type MedicationReview,
  type MedicationStatus,
  type PhysicianProfile,
} from "./medicationsApi";

type ReviewResult = { key: string; review: MedicationReview | null; error: string };

export type MedicationAccess = {
  csrfToken: string | null;
  canRead: boolean;
  canWrite: boolean;
  canDecide: boolean;
  onChanged: (message: string) => void;
};

function decisionSummary(item: MedicationItem): string {
  if (item.decision === "PENDING") return "의사 결정 대기";
  if (item.decision === "HOLD") return `중단 ${item.hold_days}일`;
  return "복용 지속";
}

/**
 * 예약 상세 준비·약제 탭의 복용약 확인과 약별 의사 결정.
 * 시스템은 중단 여부나 기간을 정하지 않고, 의사가 정한 값을 결정 의사·입력자와 함께 남긴다.
 */
export function AppointmentMedicationPanel({
  appointmentId,
  revision,
  access,
}: {
  appointmentId: string;
  revision?: number;
  access: MedicationAccess;
}) {
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const key = `${appointmentId}:${revision ?? 0}:${reload}`;

  useEffect(() => {
    if (!access.canRead) return;
    let cancelled = false;
    void medicationsApi
      .review(appointmentId)
      .then((review) => {
        if (!cancelled) setResult({ key, review, error: "" });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setResult({ key, review: null, error: medicationErrorMessage(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, key, access.canRead]);

  if (!access.canRead) {
    return (
      <section className="verification-panel" aria-label="대장내시경 복용약">
        <p className="field-note">복용약 기록을 볼 권한이 없습니다.</p>
      </section>
    );
  }

  const review = result?.key === key ? result.review : null;
  if (!review) {
    return (
      <section className="verification-panel" aria-label="대장내시경 복용약">
        {result?.key === key && result.error ? (
          <p className="schedule-action-dialog__error" role="alert">
            {result.error}
          </p>
        ) : (
          <p className="field-note">복용약 기록을 불러오는 중입니다.</p>
        )}
      </section>
    );
  }

  const active = review.workflow_state === "BOOKED";
  const canWrite = active && access.canWrite;
  const canDecide = active && access.canDecide;
  const { physician, problem } = solePhysician(review.physicians);

  const run = async (action: (csrf: string) => Promise<MedicationReview>, message: string) => {
    if (!access.csrfToken) {
      setError("보안 세션이 없어 저장할 수 없습니다. 다시 로그인해 주세요.");
      return false;
    }
    setPending(true);
    setError("");
    try {
      const updated = await action(access.csrfToken);
      setResult({ key, review: updated, error: "" });
      access.onChanged(message);
      return true;
    } catch (cause) {
      setError(medicationErrorMessage(cause));
      if (medicationNeedsReload(cause)) {
        setReload((current) => current + 1);
        access.onChanged("");
      }
      return false;
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="verification-panel medication-panel" aria-label="대장내시경 복용약">
      <div className="verification-panel__heading">
        <div>
          <span className="eyebrow">대장내시경 복용약</span>
          <h3>복용약 확인 · 의사 결정</h3>
        </div>
        <span
          className={`verification-state verification-state--${MEDICATION_STATE_TONES[review.state]}`}
          aria-label={`약제 상태 ${MEDICATION_STATE_LABELS[review.state]}`}
        >
          {MEDICATION_STATE_LABELS[review.state]}
        </span>
      </div>

      <div className="medication-warning" role="note">
        <Icon name="warning" />
        <div>
          <strong>{MEDICATION_SAFETY_NOTICE}</strong>
          <span>시스템은 중단 여부나 기간을 정하거나 권하지 않습니다.</span>
        </div>
      </div>

      {!review.has_colon && (
        <p className="field-note">
          대장내시경이 없는 예약이라 복용약 확인이 필수는 아닙니다. 필요하면 기록할 수 있습니다.
        </p>
      )}
      {!active && (
        <p className="field-note">취소되었거나 No-show로 기록된 예약에는 새로 기록할 수 없습니다.</p>
      )}

      <ChecklistForm
        key={review.checklist?.row_version ?? 0}
        checklist={review.checklist}
        disabled={!canWrite || pending}
        onSave={(body) =>
          run(
            (csrf) =>
              medicationsApi.saveChecklist(
                appointmentId,
                body,
                review.checklist?.row_version ?? null,
                csrf,
              ),
            "복용약 확인을 저장했습니다.",
          )
        }
      />

      <div className="medication-items">
        <div className="medication-items__heading">
          <strong>중단 검토 약</strong>
          <span>의사가 약마다 중단 또는 지속을 결정하면 결정 의사와 입력자를 함께 남깁니다.</span>
        </div>
        {problem && canDecide && (
          <p className="field-note medication-physician-problem" role="note">
            {problem}
          </p>
        )}
        {review.items.length === 0 ? (
          <p className="field-note">등록된 중단 검토 약이 없습니다.</p>
        ) : (
          <ul className="medication-item-list" aria-label="중단 검토 약 목록">
            {review.items.map((item) => (
              <MedicationItemCard
                key={`${item.item_key}:${item.revision}`}
                item={item}
                serviceDate={review.service_date}
                physician={physician}
                canWrite={canWrite}
                canDecide={canDecide}
                pending={pending}
                onDecide={(input) =>
                  run(
                    (csrf) =>
                      medicationsApi.decide(
                        appointmentId,
                        item,
                        decisionBody(input, physician?.id ?? ""),
                        csrf,
                      ),
                    `${item.medication_name}의 의사 결정을 기록했습니다.`,
                  )
                }
                onNotify={() =>
                  run(
                    (csrf) => medicationsApi.notify(appointmentId, item, csrf),
                    `${item.medication_name}의 환자 안내를 기록했습니다.`,
                  )
                }
                onConfirmHold={(date) =>
                  run(
                    (csrf) => medicationsApi.confirmHold(appointmentId, item, date, csrf),
                    `${item.medication_name}의 실제 중단 확인을 기록했습니다.`,
                  )
                }
                onWithdraw={(reason) =>
                  run(
                    (csrf) => medicationsApi.withdraw(appointmentId, item, reason, csrf),
                    `${item.medication_name}을(를) 철회했습니다.`,
                  )
                }
              />
            ))}
          </ul>
        )}
        {canWrite && review.checklist?.medication_status !== "NONE_CONFIRMED" && (
          <AddItemForm
            disabled={pending || !review.checklist}
            hint={review.checklist ? "" : "먼저 복용약 확인을 저장해 주세요."}
            onAdd={(name) =>
              run(
                (csrf) => medicationsApi.addItem(appointmentId, name, null, csrf),
                `${name.trim()}을(를) 중단 검토 약으로 더했습니다. 의사 결정을 기록해 주세요.`,
              )
            }
          />
        )}
      </div>

      {error && (
        <p className="schedule-action-dialog__error" role="alert">
          {error}
        </p>
      )}

      <MedicationHistory review={review} />
    </section>
  );
}

function ChecklistForm({
  checklist,
  disabled,
  onSave,
}: {
  checklist: MedicationChecklist | null;
  disabled: boolean;
  onSave: (body: ReturnType<typeof checklistBody>) => Promise<boolean>;
}) {
  const [status, setStatus] = useState<MedicationStatus>(
    checklist?.medication_status ?? "UNCHECKED",
  );
  const [medicationList, setMedicationList] = useState(checklist?.medication_list ?? "");
  const [categories, setCategories] = useState<MedicationCategories>(
    checklist?.categories ?? {
      anticoagulant: false,
      antiplatelet: false,
      circulation: false,
      cardiac: false,
      neurologic: false,
      chronic_disease: false,
    },
  );
  const [surgeryHistory, setSurgeryHistory] = useState(checklist?.surgery_history ?? "");
  const [cardiovascularHistory, setCardiovascularHistory] = useState(
    checklist?.cardiovascular_history ?? "",
  );
  const [emrRecorded, setEmrRecorded] = useState(checklist?.emr_recorded ?? false);
  const none = status === "NONE_CONFIRMED";

  return (
    <form
      className="medication-checklist"
      aria-label="복용약 확인"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(
          checklistBody({
            status,
            medicationList,
            categories,
            surgeryHistory,
            cardiovascularHistory,
            emrRecorded,
          }),
        );
      }}
    >
      <fieldset className="medication-status-options" disabled={disabled}>
        <legend>복용약 확인</legend>
        {(["UNCHECKED", "LIST_CONFIRMED", "NONE_CONFIRMED"] as const).map((option) => (
          <label className="radio-chip" key={option}>
            <input
              type="radio"
              name="medication-status"
              value={option}
              checked={status === option}
              onChange={() => setStatus(option)}
            />
            <span>{MEDICATION_STATUS_LABELS[option]}</span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>전체 복용약 목록{status === "LIST_CONFIRMED" ? " (필수)" : ""}</span>
        <textarea
          rows={3}
          value={medicationList}
          disabled={disabled}
          placeholder="약품명·용량·복용 횟수를 확인된 내용 그대로 기록합니다."
          onChange={(event) => setMedicationList(event.target.value)}
        />
      </label>
      <fieldset className="medication-categories" disabled={disabled || none}>
        <legend>복용 분류 (해당하는 것 모두)</legend>
        {MEDICATION_CATEGORY_KEYS.map((category) => (
          <label className="checkbox-chip" key={category}>
            <input
              type="checkbox"
              checked={!none && categories[category]}
              onChange={(event) =>
                setCategories((current) => ({ ...current, [category]: event.target.checked }))
              }
            />
            <span>{MEDICATION_CATEGORY_LABELS[category]}</span>
          </label>
        ))}
      </fieldset>
      <div className="medication-history-fields">
        <label className="field">
          <span>수술 이력 (선택)</span>
          <input
            value={surgeryHistory}
            maxLength={2000}
            disabled={disabled}
            onChange={(event) => setSurgeryHistory(event.target.value)}
          />
        </label>
        <label className="field">
          <span>심혈관 시술 이력 (선택)</span>
          <input
            value={cardiovascularHistory}
            maxLength={2000}
            disabled={disabled}
            onChange={(event) => setCardiovascularHistory(event.target.value)}
          />
        </label>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={emrRecorded}
          disabled={disabled}
          onChange={(event) => setEmrRecorded(event.target.checked)}
        />
        <span>
          <strong>EMR에 기록함</strong>
        </span>
      </label>
      <div className="medication-checklist__footer">
        <small>
          {checklist?.confirmed_at
            ? `확인 ${checklist.confirmed_by_name ?? "직원"} · ${formatSeoulDateTime(checklist.confirmed_at)}`
            : "아직 확인 기록이 없습니다."}
        </small>
        {!disabled && (
          <button type="submit" className="primary-button">
            <Icon name="check" />
            복용약 확인 저장
          </button>
        )}
      </div>
    </form>
  );
}

function AddItemForm({
  disabled,
  hint,
  onAdd,
}: {
  disabled: boolean;
  hint: string;
  onAdd: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  return (
    <form
      className="medication-add"
      aria-label="중단 검토 약 추가"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        void onAdd(name).then((saved) => {
          if (saved) setName("");
        });
      }}
    >
      <label className="field">
        <span>약품명</span>
        <input
          value={name}
          maxLength={100}
          disabled={disabled}
          placeholder="예: 합성약 A"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <button type="submit" className="secondary-button" disabled={disabled || !name.trim()}>
        <Icon name="add" />
        중단 검토 약 추가
      </button>
      {hint && <small className="field-note">{hint}</small>}
    </form>
  );
}

function MedicationItemCard({
  item,
  serviceDate,
  physician,
  canWrite,
  canDecide,
  pending,
  onDecide,
  onNotify,
  onConfirmHold,
  onWithdraw,
}: {
  item: MedicationItem;
  serviceDate: string;
  physician: PhysicianProfile | null;
  canWrite: boolean;
  canDecide: boolean;
  pending: boolean;
  onDecide: (input: {
    decision: MedicationDecision;
    holdDays: string;
    rationale: string;
    physicianConfirmed: boolean;
  }) => Promise<boolean>;
  onNotify: () => Promise<boolean>;
  onConfirmHold: (date: string) => Promise<boolean>;
  onWithdraw: (reason: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"view" | "decide" | "withdraw">("view");
  const [holdDate, setHoldDate] = useState(seoulTodayIso());
  const [withdrawReason, setWithdrawReason] = useState("");
  const decided = item.decision !== "PENDING";
  const current = decided && !item.needs_re_review;

  return (
    <li className={`medication-item ${item.needs_re_review ? "is-outdated" : ""}`}>
      <div className="medication-item__heading">
        <strong>{item.medication_name}</strong>
        <span
          className={`verification-state verification-state--${
            !decided || item.needs_re_review ? "danger" : "success"
          }`}
        >
          {item.needs_re_review ? "재검토 필요" : decisionSummary(item)}
        </span>
      </div>
      {decided && (
        <p className="medication-item__meta">
          {decisionSummary(item)}
          {item.rationale ? ` · ${item.decision === "CONTINUE" ? "사유" : "메모"}: ${item.rationale}` : ""}
          {` · 결정 의사 ${item.physician_name ?? "-"} · 입력 ${item.recorded_by_name ?? "-"} · ${formatSeoulDateTime(item.recorded_at)}`}
        </p>
      )}
      {item.needs_re_review && (
        <div className="verification-alert" role="status">
          <Icon name="warning" />
          <div>
            <strong>검사일이 바뀌어 의사 재검토가 필요합니다</strong>
            <span>
              결정 당시 검사일 {item.decided_for_service_date} → 현재 {serviceDate}. 이전 결정은
              이력에 남고, 새 결정은 의사가 다시 정해야 합니다.
            </span>
          </div>
        </div>
      )}

      {current && (
        <dl className="medication-item__checks">
          <div>
            <dt>환자 안내</dt>
            <dd>
              {item.patient_notified_at ? (
                `${item.patient_notified_by_name ?? "직원"} · ${formatSeoulDateTime(item.patient_notified_at)}`
              ) : canWrite ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pending}
                  onClick={() => void onNotify()}
                >
                  환자 안내 완료 기록
                </button>
              ) : (
                "대기"
              )}
            </dd>
          </div>
          {item.decision === "HOLD" && (
            <div>
              <dt>실제 중단 확인</dt>
              <dd>
                {item.hold_confirmed_on ? (
                  `${item.hold_confirmed_on} 확인 · ${item.hold_confirmed_by_name ?? "직원"}`
                ) : canWrite ? (
                  <span className="medication-hold-confirm">
                    <input
                      type="date"
                      aria-label="실제 중단 확인일"
                      value={holdDate}
                      max={serviceDate}
                      onChange={(event) => setHoldDate(event.target.value)}
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={pending || !holdDate}
                      onClick={() => void onConfirmHold(holdDate)}
                    >
                      실제 중단 확인 기록
                    </button>
                  </span>
                ) : (
                  "대기"
                )}
              </dd>
            </div>
          )}
        </dl>
      )}

      {mode === "view" && (canDecide || canWrite) && (
        <div className="medication-item__actions">
          {canDecide && (
            <button
              type="button"
              className="primary-button"
              disabled={pending || !physician}
              onClick={() => setMode("decide")}
            >
              {decided ? "의사 결정 다시 기록" : "의사 결정 기록"}
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              className="text-button text-button--danger"
              disabled={pending}
              onClick={() => setMode("withdraw")}
            >
              철회
            </button>
          )}
        </div>
      )}

      {mode === "decide" && physician && (
        <DecisionForm
          physician={physician}
          pending={pending}
          onCancel={() => setMode("view")}
          onSubmit={async (input) => {
            const saved = await onDecide(input);
            if (saved) setMode("view");
          }}
        />
      )}

      {mode === "withdraw" && (
        <form
          className="verification-correction"
          onSubmit={(event) => {
            event.preventDefault();
            if (!withdrawReason.trim()) return;
            void onWithdraw(withdrawReason).then((saved) => {
              if (saved) setMode("view");
            });
          }}
        >
          <div>
            <strong>이 약을 중단 검토 목록에서 철회합니다</strong>
            <span>기록은 지우지 않고 철회 사유와 함께 이력에 남습니다.</span>
          </div>
          <label>
            철회 사유
            <textarea
              rows={2}
              value={withdrawReason}
              maxLength={500}
              onChange={(event) => setWithdrawReason(event.target.value)}
            />
          </label>
          <div>
            <button type="button" className="secondary-button" onClick={() => setMode("view")}>
              그대로 유지
            </button>
            <button
              type="submit"
              className="secondary-button verification-correct-button"
              disabled={pending || !withdrawReason.trim()}
            >
              철회
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

function DecisionForm({
  physician,
  pending,
  onCancel,
  onSubmit,
}: {
  physician: PhysicianProfile;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    decision: MedicationDecision;
    holdDays: string;
    rationale: string;
    physicianConfirmed: boolean;
  }) => Promise<void>;
}) {
  const [decision, setDecision] = useState<MedicationDecision>("HOLD");
  const [holdDays, setHoldDays] = useState("");
  const [rationale, setRationale] = useState("");
  const [physicianConfirmed, setPhysicianConfirmed] = useState(false);
  const daysValid = /^\d+$/.test(holdDays) && Number(holdDays) >= 1 && Number(holdDays) <= 90;
  const ready =
    physicianConfirmed && (decision === "HOLD" ? daysValid : Boolean(rationale.trim()));

  return (
    <form
      className="medication-decision-form"
      aria-label="의사 결정 기록"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        void onSubmit({ decision, holdDays, rationale, physicianConfirmed });
      }}
    >
      <p className="field-note">결정 의사: {physician.display_name}</p>
      <fieldset className="medication-status-options">
        <legend>의사 결정</legend>
        <label className="radio-chip">
          <input
            type="radio"
            name="medication-decision"
            checked={decision === "HOLD"}
            onChange={() => setDecision("HOLD")}
          />
          <span>중단</span>
        </label>
        <label className="radio-chip">
          <input
            type="radio"
            name="medication-decision"
            checked={decision === "CONTINUE"}
            onChange={() => setDecision("CONTINUE")}
          />
          <span>복용 지속</span>
        </label>
      </fieldset>
      {decision === "HOLD" && (
        <label className="field">
          <span>의사가 정한 중단 일수 (1~90)</span>
          <input
            type="number"
            min={1}
            max={90}
            step={1}
            inputMode="numeric"
            value={holdDays}
            onChange={(event) => setHoldDays(event.target.value)}
          />
        </label>
      )}
      <label className="field">
        <span>{decision === "CONTINUE" ? "지속 사유 (필수)" : "메모 (선택)"}</span>
        <textarea
          rows={2}
          maxLength={500}
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={physicianConfirmed}
          onChange={(event) => setPhysicianConfirmed(event.target.checked)}
        />
        <span>
          <strong>담당 의사가 결정한 내용임을 확인했습니다</strong>
          <small>시스템이 권하는 값이 아니라 의사가 정한 값만 기록합니다.</small>
        </span>
      </label>
      <div className="medication-decision-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          취소
        </button>
        <button type="submit" className="primary-button" disabled={pending || !ready}>
          결정 저장
        </button>
      </div>
    </form>
  );
}

function MedicationHistory({ review }: { review: MedicationReview }) {
  const total = review.checklist_history.length + review.item_history.length;
  if (total === 0) return null;
  return (
    <details className="verification-history">
      <summary>복용약 기록 이력 {total}건</summary>
      <ol>
        {review.item_history.map((item) => (
          <li className={item.status === "ACTIVE" ? "" : "is-invalid"} key={item.id}>
            <strong>
              {item.medication_name} · {decisionSummary(item)}
              {item.status === "SUPERSEDED" ? " · 이후 결정으로 대체" : ""}
              {item.status === "WITHDRAWN" ? " · 철회" : ""}
            </strong>
            <small>
              입력 {item.recorded_by_name ?? "-"} · {formatSeoulDateTime(item.recorded_at)}
              {item.physician_name ? ` · 결정 의사 ${item.physician_name}` : ""}
              {item.decided_for_service_date ? ` · 검사일 ${item.decided_for_service_date} 기준` : ""}
              {item.patient_notified_at
                ? ` · 안내 ${item.patient_notified_by_name ?? "-"} ${formatSeoulDateTime(item.patient_notified_at)}`
                : ""}
              {item.end_reason ? ` · 철회 사유: ${item.end_reason}` : ""}
            </small>
          </li>
        ))}
        {review.checklist_history.map((entry) => (
          <li key={`checklist-${entry.revision}`}>
            <strong>
              복용약 확인 {entry.revision}회차 · {MEDICATION_STATUS_LABELS[entry.snapshot.medication_status]}
            </strong>
            <small>
              {entry.saved_by_name ?? "-"} · {formatSeoulDateTime(entry.saved_at)}
              {entry.snapshot.medication_list ? ` · 목록: ${entry.snapshot.medication_list}` : ""}
              {MEDICATION_CATEGORY_KEYS.some((category) => entry.snapshot.categories[category])
                ? ` · 분류: ${MEDICATION_CATEGORY_KEYS.filter((category) => entry.snapshot.categories[category])
                    .map((category) => MEDICATION_CATEGORY_LABELS[category])
                    .join("·")}`
                : ""}
            </small>
          </li>
        ))}
      </ol>
    </details>
  );
}
