import { useEffect, useState } from "react";
import { addCalendarDays, koreanDateLabel, seoulTodayIso } from "./calendarDates";
import { Icon } from "./icons";
import {
  ISSUE_LABELS,
  overrideDetail,
  RULE_TYPE_LABELS,
  scheduleOverridesApi,
  STATUS_LABELS,
  type ImpactedAppointment,
  type OverrideDraft,
  type OverrideRuleType,
  type ScheduleOverride,
} from "./scheduleOverridesApi";

// 오늘부터 이 기간의 예외를 보여 준다(Backend 조회 한도 366일 안).
const LIST_DAYS = 120;

const RULE_TYPES: OverrideRuleType[] = [
  "CLOSED",
  "OPERATING_HOURS",
  "CAPACITY",
  "AFTERNOON_ALLOW",
];

type ListResult = { key: string; items: ScheduleOverride[]; error: string };
type Decision = {
  title: string;
  serviceDate: string;
  impacted: ImpactedAppointment[];
};

function emptyDraft(): OverrideDraft {
  return {
    serviceDate: addCalendarDays(seoulTodayIso(), 1),
    ruleType: "CLOSED",
    startTime: "09:00",
    endTime: "11:00",
    upperCapacity: "",
    colonCapacity: "",
    reason: "",
  };
}

/**
 * 날짜별 휴진·운영시간·수용량·오후 예외 허용 규칙을 등록하고 승인·취소한다.
 * 승인해도 기존 예약을 자동으로 옮기거나 취소하지 않으므로, 영향받는 예약을 보여 준다.
 */
export function ScheduleOverridePanel({
  csrfToken,
  onScheduleChanged,
}: {
  csrfToken: string | null;
  onScheduleChanged: (message: string) => void;
}) {
  const [draft, setDraft] = useState<OverrideDraft>(emptyDraft);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<ListResult | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [revoking, setRevoking] = useState<{ id: string; reason: string } | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);

  const startDate = seoulTodayIso();
  const endDate = addCalendarDays(startDate, LIST_DAYS);
  const listKey = `${startDate}|${endDate}|${revision}`;

  useEffect(() => {
    let cancelled = false;
    void scheduleOverridesApi
      .list(startDate, endDate)
      .then((items) => {
        if (!cancelled) setResult({ key: listKey, items, error: "" });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setResult({
          key: listKey,
          items: [],
          error: cause instanceof Error ? cause.message : "일정 예외를 불러오지 못했습니다.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, listKey]);

  const loading = result?.key !== listKey;
  const items = result?.key === listKey ? result.items : [];
  const busy = pendingId !== null;

  const refresh = (message: string) => {
    setRevision((current) => current + 1);
    onScheduleChanged(message);
  };

  const requireCsrf = () => {
    if (!csrfToken) throw new Error("보안 세션이 없어 저장할 수 없습니다. 다시 로그인해 주세요.");
    return csrfToken;
  };

  const patch = (next: Partial<OverrideDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setFormError("");
  };

  const submit = async () => {
    if (!draft.reason.trim()) {
      setFormError("등록 사유를 입력해 주세요.");
      return;
    }
    setPendingId("new");
    setFormError("");
    try {
      const created = await scheduleOverridesApi.create(draft, requireCsrf());
      setDraft(emptyDraft());
      refresh(
        `${koreanDateLabel(created.service_date)} ${RULE_TYPE_LABELS[created.rule_type]}을 승인 대기로 등록했습니다.`,
      );
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "일정 예외를 등록하지 못했습니다.");
    } finally {
      setPendingId(null);
    }
  };

  const approve = async (item: ScheduleOverride) => {
    setPendingId(item.id);
    setActionError("");
    try {
      const response = await scheduleOverridesApi.approve(item.id, requireCsrf());
      setDecision({
        title: `${RULE_TYPE_LABELS[item.rule_type]} 승인`,
        serviceDate: item.service_date,
        impacted: response.impacted_appointments,
      });
      refresh(`${koreanDateLabel(item.service_date)} 일정 예외를 승인했습니다.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "승인하지 못했습니다.");
    } finally {
      setPendingId(null);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    const item = items.find((candidate) => candidate.id === revoking.id);
    if (!item) return;
    if (!revoking.reason.trim()) {
      setActionError("취소 사유를 입력해 주세요.");
      return;
    }
    setPendingId(item.id);
    setActionError("");
    try {
      const response = await scheduleOverridesApi.revoke(item.id, revoking.reason, requireCsrf());
      setRevoking(null);
      setDecision({
        title: `${RULE_TYPE_LABELS[item.rule_type]} 취소`,
        serviceDate: item.service_date,
        impacted: response.impacted_appointments,
      });
      refresh(`${koreanDateLabel(item.service_date)} 일정 예외를 취소했습니다.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "취소하지 못했습니다.");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="override-panel" aria-labelledby="override-panel-title">
      <div className="override-panel__heading">
        <h2 id="override-panel-title">날짜별 일정 예외</h2>
        <p>
          휴진·운영시간·수용량·14:00 오후 예외 허용을 날짜별로 등록하고 승인합니다. 승인해도
          기존 예약을 자동으로 옮기거나 취소하지 않습니다.
        </p>
      </div>

      <form
        className="override-form"
        aria-label="일정 예외 등록"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>날짜</span>
          <input
            type="date"
            value={draft.serviceDate}
            min={seoulTodayIso()}
            disabled={busy}
            onChange={(event) => event.target.value && patch({ serviceDate: event.target.value })}
          />
        </label>
        <label className="field">
          <span>종류</span>
          <select
            value={draft.ruleType}
            disabled={busy}
            onChange={(event) => patch({ ruleType: event.target.value as OverrideRuleType })}
          >
            {RULE_TYPES.map((type) => (
              <option key={type} value={type}>
                {RULE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        {draft.ruleType === "OPERATING_HOURS" && (
          <>
            <label className="field">
              <span>시작</span>
              <input
                type="time"
                step={1800}
                value={draft.startTime}
                disabled={busy}
                onChange={(event) => patch({ startTime: event.target.value })}
              />
            </label>
            <label className="field">
              <span>종료</span>
              <input
                type="time"
                step={1800}
                value={draft.endTime}
                disabled={busy}
                onChange={(event) => patch({ endTime: event.target.value })}
              />
            </label>
          </>
        )}
        {draft.ruleType === "CAPACITY" && (
          <>
            <label className="field">
              <span>위 수용량</span>
              <input
                type="number"
                min={0}
                max={50}
                placeholder="그대로"
                value={draft.upperCapacity}
                disabled={busy}
                onChange={(event) => patch({ upperCapacity: event.target.value })}
              />
            </label>
            <label className="field">
              <span>대장 수용량</span>
              <input
                type="number"
                min={0}
                max={50}
                placeholder="그대로"
                value={draft.colonCapacity}
                disabled={busy}
                onChange={(event) => patch({ colonCapacity: event.target.value })}
              />
            </label>
          </>
        )}
        <label className="field override-form__reason">
          <span>사유 (필수)</span>
          <input
            value={draft.reason}
            maxLength={500}
            disabled={busy}
            placeholder="예: 장비 정기점검"
            onChange={(event) => patch({ reason: event.target.value })}
          />
        </label>
        <button type="submit" className="primary-button" disabled={busy || !draft.reason.trim()}>
          <Icon name="add" />
          {pendingId === "new" ? "등록 중" : "승인 대기로 등록"}
        </button>
        {formError && (
          <p className="schedule-action-dialog__error override-form__error" role="alert">
            {formError}
          </p>
        )}
      </form>

      {decision && (
        <div className="override-decision" role="status">
          <strong>
            {koreanDateLabel(decision.serviceDate)} {decision.title}
          </strong>
          {decision.impacted.length === 0 ? (
            <span>새 규칙과 어긋나는 기존 예약이 없습니다.</span>
          ) : (
            <>
              <span>
                새 규칙과 어긋나는 예약 {decision.impacted.length}건이 있습니다. 자동으로 바뀌지
                않으니 환자에게 연락해 직접 변경·취소해 주세요.
              </span>
              <ul aria-label="영향받는 예약">
                {decision.impacted.map((item) => (
                  <li key={item.id}>
                    {item.start_time.slice(0, 5)}~{item.end_time.slice(0, 5)} ·{" "}
                    {item.procedures.map((code) => (code === "COLON" ? "대장" : "위")).join("·")} ·{" "}
                    {ISSUE_LABELS[item.issue]}
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="button" className="text-button" onClick={() => setDecision(null)}>
            닫기
          </button>
        </div>
      )}

      {actionError && (
        <p className="schedule-action-dialog__error" role="alert">
          {actionError}
        </p>
      )}

      {loading ? (
        <p className="field-note">일정 예외를 불러오는 중입니다.</p>
      ) : result?.error ? (
        <p className="schedule-action-dialog__error" role="alert">
          {result.error}
        </p>
      ) : items.length === 0 ? (
        <p className="field-note">앞으로 {LIST_DAYS}일 안에 등록된 일정 예외가 없습니다.</p>
      ) : (
        <ul className="override-list" aria-label="일정 예외 목록">
          {items.map((item) => {
            const active = item.status === "PENDING" || item.status === "APPROVED";
            const detail = overrideDetail(item);
            return (
              <li key={item.id} className={`override-row override-row--${item.status.toLowerCase()}`}>
                <div className="override-row__main">
                  <strong>{koreanDateLabel(item.service_date)}</strong>
                  <span>
                    {RULE_TYPE_LABELS[item.rule_type]}
                    {detail ? ` · ${detail}` : ""}
                  </span>
                  <small>{item.reason}</small>
                  {item.revoke_reason && <small>취소 사유: {item.revoke_reason}</small>}
                </div>
                <em>{STATUS_LABELS[item.status]}</em>
                <div className="override-row__actions">
                  {item.status === "PENDING" && (
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy}
                      onClick={() => void approve(item)}
                    >
                      승인
                    </button>
                  )}
                  {active && revoking?.id !== item.id && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        setActionError("");
                        setRevoking({ id: item.id, reason: "" });
                      }}
                    >
                      취소
                    </button>
                  )}
                </div>
                {revoking?.id === item.id && (
                  <div className="override-row__revoke">
                    <label className="field">
                      <span>취소 사유 (필수)</span>
                      <input
                        autoFocus
                        value={revoking.reason}
                        maxLength={500}
                        disabled={busy}
                        onChange={(event) =>
                          setRevoking({ id: item.id, reason: event.target.value })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => setRevoking(null)}
                    >
                      그대로 유지
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={busy || !revoking.reason.trim()}
                      onClick={() => void revoke()}
                    >
                      예외 취소
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
