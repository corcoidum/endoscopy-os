import { useEffect, useState } from "react";
import { ApiError } from "./api";
import { appointmentsApi } from "./appointmentsApi";
import { koreanDateLabel } from "./calendarDates";
import type { Appointment } from "./data";
import { Icon } from "./icons";

export type AppointmentReasonAction = "cancel" | "no-show" | "confirm-exception";

const COPY: Record<
  AppointmentReasonAction,
  {
    title: string;
    label: string;
    placeholder: string;
    submit: string;
    notice: string;
    done: (name: string) => string;
    danger: boolean;
  }
> = {
  cancel: {
    title: "예약 취소",
    label: "취소 사유 (필수)",
    placeholder: "예: 환자 사정으로 검사 취소 요청",
    submit: "예약 취소",
    notice: "취소하면 이 시간과 수용량이 바로 풀리고, 취소한 예약은 다시 변경할 수 없습니다.",
    done: (name) => `${name}님의 예약을 취소했습니다.`,
    danger: true,
  },
  "no-show": {
    title: "No-show 기록",
    label: "기록 사유 (필수)",
    placeholder: "예: 예약 시각 30분 경과, 연락 두절",
    submit: "No-show 기록",
    notice: "예약 시작시각이 지난 뒤에만 기록할 수 있습니다. 기록하면 시간과 수용량이 풀립니다.",
    done: (name) => `${name}님의 예약을 No-show로 기록했습니다.`,
    danger: true,
  },
  "confirm-exception": {
    title: "14:00 오후 예외 확인",
    label: "확인 메모 (필수)",
    placeholder: "예: 원장님 승인, 오후 검사 인력 확인 완료",
    submit: "확인 완료",
    notice: "오후 예외는 등록한 직원이 아닌 다른 직원이 확인해야 합니다.",
    done: (name) => `${name}님의 14:00 오후 예외를 확인했습니다.`,
    danger: false,
  },
};

/** 사유 하나만 받아 실제 예약 상태를 바꾸는 취소·No-show·오후 예외 확인 Dialog. */
export function AppointmentReasonDialog({
  appointment,
  action,
  csrfToken,
  onClose,
  onDone,
  onStale,
}: {
  appointment: Appointment;
  action: AppointmentReasonAction;
  csrfToken: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
  onStale: (message: string) => void;
}) {
  const copy = COPY[action];
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, pending]);

  const submit = async () => {
    if (!reason.trim()) {
      setError(`${copy.label.replace(" (필수)", "")}를 입력해 주세요.`);
      return;
    }
    if (!csrfToken) {
      setError("보안 세션이 없어 저장할 수 없습니다. 다시 로그인해 주세요.");
      return;
    }
    setPending(true);
    setError("");
    try {
      if (action === "cancel") {
        await appointmentsApi.cancel(appointment, reason, csrfToken);
      } else if (action === "no-show") {
        await appointmentsApi.noShow(appointment, reason, csrfToken);
      } else {
        await appointmentsApi.confirmException(appointment, reason, csrfToken);
      }
      onDone(copy.done(appointment.name));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "STALE_ROW_VERSION") {
        onStale(cause.message);
        return;
      }
      setError(cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !pending && onClose()}>
      <section
        className="schedule-action-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-reason-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="schedule-action-dialog__header">
          <div>
            <p>
              {appointment.name} · {koreanDateLabel(appointment.date)} {appointment.start}
            </p>
            <h2 id="appointment-reason-title">{copy.title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="닫기"
            disabled={pending}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="schedule-action-dialog__body">
          <p className="schedule-action-dialog__notice">{copy.notice}</p>
          <label className="field">
            <span>{copy.label}</span>
            <textarea
              autoFocus
              rows={3}
              maxLength={500}
              value={reason}
              disabled={pending}
              placeholder={copy.placeholder}
              onChange={(event) => {
                setReason(event.target.value);
                setError("");
              }}
            />
          </label>
          {error && (
            <p className="schedule-action-dialog__error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="schedule-action-dialog__footer">
          <button
            type="button"
            className="secondary-button"
            disabled={pending}
            onClick={onClose}
          >
            닫기
          </button>
          <button
            type="button"
            className={copy.danger ? "danger-button" : "primary-button"}
            disabled={pending || !reason.trim()}
            onClick={() => void submit()}
          >
            {pending ? "처리 중" : copy.submit}
          </button>
        </footer>
      </section>
    </div>
  );
}
