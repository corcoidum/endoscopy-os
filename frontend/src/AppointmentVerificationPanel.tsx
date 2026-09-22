import { useEffect, useState } from "react";
import {
  formatSeoulDateTime,
  subjectAgeSex,
  subjectProcedures,
} from "./appointmentPresentation";
import { Icon } from "./icons";
import {
  INVALIDATION_LABELS,
  METHOD_LABELS,
  VERIFICATION_STATE_LABELS,
  verificationErrorMessage,
  verificationNeedsReload,
  verificationsApi,
  type VerificationMethod,
  type VerificationRecord,
  type VerificationStage,
  type VerificationStatus,
} from "./verificationsApi";

type StatusResult = { key: string; status: VerificationStatus | null; error: string };

const METHODS = Object.keys(METHOD_LABELS) as VerificationMethod[];

const STATE_TONES: Record<VerificationStatus["state"], string> = {
  UNVERIFIED: "warning",
  PRIMARY_DONE: "warning",
  VERIFIED: "success",
  REVERIFY_REQUIRED: "danger",
};

function stageLabel(stage: VerificationStage): string {
  return stage === "PRIMARY" ? "1차" : "2차";
}

function RecordLine({ record }: { record: VerificationRecord }) {
  return (
    <span>
      {record.verified_by_name} · {formatSeoulDateTime(record.verified_at)} ·{" "}
      {METHOD_LABELS[record.method]}
      {record.memo ? ` · ${record.memo}` : ""}
    </span>
  );
}

/**
 * 실제 예약의 인적사항 1·2차 확인, 2차 확인 정정(사유 → 완료 상태 취소 두 단계),
 * 확인 이력을 보여 준다. 상태는 매번 Backend에서 다시 읽어 새로고침·재로그인 뒤에도 같다.
 */
export function AppointmentVerificationPanel({
  appointmentId,
  revision,
  csrfToken,
  currentUserId,
  canPrimary,
  canSecondary,
  onChanged,
}: {
  appointmentId: string;
  /** 예약이 바뀌면 다시 읽도록 row_version을 받는다. */
  revision: number | undefined;
  csrfToken: string | null;
  currentUserId: string;
  canPrimary: boolean;
  canSecondary: boolean;
  /** 저장·충돌 뒤 일정 목록을 다시 받도록 알린다. */
  onChanged: (message: string) => void;
}) {
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<StatusResult | null>(null);
  const [method, setMethod] = useState<VerificationMethod>("IN_PERSON");
  const [memo, setMemo] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");

  const key = `${appointmentId}:${revision ?? 0}:${reload}`;

  useEffect(() => {
    let cancelled = false;
    void verificationsApi
      .status(appointmentId)
      .then((status) => {
        if (!cancelled) setResult({ key, status, error: "" });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setResult({
          key,
          status: null,
          error: cause instanceof Error ? cause.message : "확인 상태를 불러오지 못했습니다.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, key]);

  const status = result?.key === key ? result.status : null;

  const requireCsrf = () => {
    if (!csrfToken) throw new Error("보안 세션이 없어 저장할 수 없습니다. 다시 로그인해 주세요.");
    return csrfToken;
  };

  const handleFailure = (cause: unknown) => {
    setError(verificationErrorMessage(cause));
    if (verificationNeedsReload(cause)) {
      // 낡은 화면으로 판단된 경우 최신 확인 상태와 일정 목록을 다시 받는다.
      setReload((current) => current + 1);
      onChanged("");
    }
  };

  const verify = async (stage: VerificationStage) => {
    if (!status) return;
    setPending(true);
    setError("");
    try {
      await verificationsApi.verify(
        appointmentId,
        stage,
        status.fingerprint,
        method,
        memo,
        requireCsrf(),
      );
      setMemo("");
      setReload((current) => current + 1);
      onChanged(`${status.current.name}님의 ${stageLabel(stage)} 확인을 저장했습니다.`);
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setPending(false);
    }
  };

  const correct = async () => {
    if (!status?.secondary) return;
    if (!correctionReason.trim()) {
      setError("정정 사유를 입력해 주세요.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await verificationsApi.correctSecondary(
        appointmentId,
        status.secondary.id,
        correctionReason,
        requireCsrf(),
      );
      setCorrecting(false);
      setCorrectionReason("");
      setReload((current) => current + 1);
      onChanged(`${status.current.name}님의 2차 확인 완료를 정정했습니다. 2차 재확인이 필요합니다.`);
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setPending(false);
    }
  };

  if (!status) {
    return (
      <section className="verification-panel" aria-label="인적사항 이중확인">
        {result?.key === key && result.error ? (
          <p className="schedule-action-dialog__error" role="alert">
            {result.error}
          </p>
        ) : (
          <p className="field-note">확인 상태를 불러오는 중입니다.</p>
        )}
      </section>
    );
  }

  const active = status.workflow_state === "BOOKED";
  const current = status.current;
  const primaryIsMine = status.primary?.verified_by_user_id === currentUserId;
  const showPrimaryForm =
    active && canPrimary && (status.state === "UNVERIFIED" || status.state === "REVERIFY_REQUIRED");
  const showSecondaryForm = active && canSecondary && status.state === "PRIMARY_DONE";
  const lastInvalidation = status.last_invalidation;
  const recheckNotice =
    lastInvalidation &&
    (status.state === "REVERIFY_REQUIRED" ||
      (status.state === "PRIMARY_DONE" && lastInvalidation.invalidation_type === "CORRECTED"));

  return (
    <section className="verification-panel" aria-label="인적사항 이중확인">
      <div className="verification-panel__heading">
        <div>
          <span className="eyebrow">인적사항 이중확인</span>
          <h3>1차·2차 확인</h3>
        </div>
        <span
          className={`verification-state verification-state--${STATE_TONES[status.state]}`}
          aria-label={`확인 상태 ${VERIFICATION_STATE_LABELS[status.state]}`}
        >
          {VERIFICATION_STATE_LABELS[status.state]}
        </span>
      </div>

      {recheckNotice && lastInvalidation && (
        <div className="verification-alert" role="status">
          <Icon name="warning" />
          <div>
            <strong>
              {status.state === "REVERIFY_REQUIRED" ? "재확인 필요" : "2차 재확인 필요"} ·{" "}
              {lastInvalidation.invalidation_type
                ? INVALIDATION_LABELS[lastInvalidation.invalidation_type]
                : ""}
            </strong>
            <span>
              {lastInvalidation.invalidation_reason}
              {lastInvalidation.invalidated_at
                ? ` (${lastInvalidation.invalidated_by_name ?? "시스템"} · ${formatSeoulDateTime(lastInvalidation.invalidated_at)})`
                : ""}
            </span>
          </div>
        </div>
      )}

      <dl className="appointment-detail-list verification-subject" aria-label="확인할 핵심정보">
        <div><dt>이름</dt><dd>{current.name}</dd></div>
        <div><dt>차트번호</dt><dd>{current.chart_number}</dd></div>
        <div><dt>생년월일</dt><dd>{current.birth_date}</dd></div>
        <div><dt>나이 · 성별</dt><dd>{subjectAgeSex(current)} (기준일 {current.age_reference_date})</dd></div>
        <div><dt>검사 일시</dt><dd>{current.service_date} {current.start_time}</dd></div>
        <div><dt>검사 · 수면</dt><dd>{subjectProcedures(current)}</dd></div>
        <div><dt>구분</dt><dd>{current.care_type === "SCREENING" ? "검진" : "일반"}</dd></div>
      </dl>

      <dl className="appointment-detail-list verification-stages" aria-label="유효한 확인">
        <div>
          <dt>1차 확인</dt>
          <dd>{status.primary ? <RecordLine record={status.primary} /> : "대기"}</dd>
        </div>
        <div>
          <dt>2차 확인</dt>
          <dd>{status.secondary ? <RecordLine record={status.secondary} /> : "대기"}</dd>
        </div>
      </dl>

      {!active && (
        <p className="field-note">취소되었거나 No-show로 기록된 예약은 새로 확인할 수 없습니다.</p>
      )}
      {active && !canPrimary &&
        (status.state === "UNVERIFIED" || status.state === "REVERIFY_REQUIRED") && (
        <p className="field-note">
          이 계정에는 1차 확인 권한이 없습니다. 1차 확인 권한이 있는 직원에게 요청해 주세요.
        </p>
      )}
      {active && !canSecondary && status.state === "PRIMARY_DONE" && (
        <p className="field-note">
          이 계정에는 2차 확인 권한이 없습니다. 2차 확인 권한이 있는 직원에게 요청해 주세요.
        </p>
      )}

      {(showPrimaryForm || showSecondaryForm) && (
        <div className="verification-form">
          <label className="field">
            <span>확인 방법</span>
            <select
              value={method}
              disabled={pending}
              onChange={(event) => setMethod(event.target.value as VerificationMethod)}
            >
              {METHODS.map((item) => (
                <option key={item} value={item}>
                  {METHOD_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>메모 (선택)</span>
            <input
              value={memo}
              maxLength={500}
              disabled={pending}
              onChange={(event) => setMemo(event.target.value)}
            />
          </label>
          {showPrimaryForm && (
            <button
              type="button"
              className="primary-button"
              disabled={pending}
              onClick={() => void verify("PRIMARY")}
            >
              <Icon name="check" />
              위 정보로 1차 확인
            </button>
          )}
          {showSecondaryForm && (
            <button
              type="button"
              className="primary-button"
              disabled={pending || primaryIsMine}
              title={primaryIsMine ? "1차 확인자와 같은 계정은 2차 확인할 수 없습니다." : undefined}
              onClick={() => void verify("SECONDARY")}
            >
              <Icon name="shield" />
              위 정보로 2차 확인
            </button>
          )}
          {showSecondaryForm && primaryIsMine && (
            <p className="field-note">
              1차 확인자와 같은 계정입니다. 다른 직원이 로그인해 2차 확인해야 합니다.
            </p>
          )}
        </div>
      )}

      {active && canSecondary && status.state === "VERIFIED" && !correcting && (
        <button
          type="button"
          className="secondary-button verification-correct-button"
          disabled={pending}
          onClick={() => {
            setError("");
            setCorrecting(true);
          }}
        >
          <Icon name="history" />
          2차 확인 정정
        </button>
      )}

      {correcting && (
        <form
          className="verification-correction"
          onSubmit={(event) => {
            event.preventDefault();
            void correct();
          }}
        >
          <div>
            <strong>2차 확인 완료를 취소하시겠습니까?</strong>
            <span>1차 확인은 유지되고, 2차 확인 대기로 돌아갑니다. 정정 사유와 시각이 기록됩니다.</span>
          </div>
          <label>
            정정 사유
            <textarea
              autoFocus
              rows={2}
              maxLength={500}
              value={correctionReason}
              disabled={pending}
              onChange={(event) => {
                setCorrectionReason(event.target.value);
                setError("");
              }}
              placeholder="예: 다른 환자 화면에서 확인함"
            />
          </label>
          <div>
            <button
              type="button"
              className="secondary-button"
              disabled={pending}
              onClick={() => {
                setCorrecting(false);
                setCorrectionReason("");
                setError("");
              }}
            >
              그대로 유지
            </button>
            <button type="submit" className="danger-button" disabled={pending}>
              완료 상태 취소
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="schedule-action-dialog__error" role="alert">
          {error}
        </p>
      )}

      {status.history.length > 0 && (
        <details className="verification-history">
          <summary>확인 이력 {status.history.length}건</summary>
          <ol aria-label="인적사항 확인 이력">
            {status.history.map((record) => (
              <li key={record.id} className={record.is_valid ? "" : "is-invalid"}>
                <strong>
                  {stageLabel(record.stage)} 확인 · {record.is_valid ? "유효" : "무효"}
                </strong>
                <RecordLine record={record} />
                <small>
                  확인 당시: {record.subject.name} · {record.subject.chart_number} ·{" "}
                  {subjectAgeSex(record.subject)} · {record.subject.service_date}{" "}
                  {record.subject.start_time} · {subjectProcedures(record.subject)}
                </small>
                {!record.is_valid && record.invalidation_type && (
                  <small>
                    {INVALIDATION_LABELS[record.invalidation_type]}: {record.invalidation_reason}
                    {record.invalidated_at
                      ? ` (${record.invalidated_by_name ?? "시스템"} · ${formatSeoulDateTime(record.invalidated_at)})`
                      : ""}
                  </small>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
