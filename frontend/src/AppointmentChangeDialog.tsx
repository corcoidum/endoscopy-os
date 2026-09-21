import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import {
  appointmentChangeFrom,
  appointmentsApi,
  bookingBucketOf,
  type AppointmentChange,
} from "./appointmentsApi";
import { koreanDateLabel } from "./calendarDates";
import type { Appointment, CareCategory, ProcedureKind } from "./data";
import { Icon } from "./icons";

type SlotResult = { key: string; starts: string[]; error: string };

// 이 오류는 가능 시간이 바뀌었다는 뜻이라 목록을 다시 받아 온다.
const RETRY_WITH_FRESH_SLOTS = new Set([
  "TIME_CONFLICT",
  "CAPACITY_EXCEEDED",
  "END_TIME_EXCEEDED",
  "AFTERNOON_LIMIT_EXCEEDED",
]);

const PROCEDURE_OPTIONS: ProcedureKind[] = ["위", "대장", "위·대장"];
const CARE_OPTIONS: CareCategory[] = ["일반", "검진"];

/**
 * Backend에 저장된 예약의 일정·검사 구성을 바꾼다.
 * 환자 정보와 준비·결제 항목은 이 API의 대상이 아니라서 다루지 않는다.
 */
export function AppointmentChangeDialog({
  appointment,
  csrfToken,
  onClose,
  onDone,
  onStale,
}: {
  appointment: Appointment;
  csrfToken: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
  onStale: (message: string) => void;
}) {
  const [change, setChange] = useState<AppointmentChange>(() =>
    appointmentChangeFrom(appointment),
  );
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [slotRevision, setSlotRevision] = useState(0);
  const [slots, setSlots] = useState<SlotResult | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const bucket = bookingBucketOf(appointment);
  // 당일 예약은 다른 날짜로 옮길 수 없고 위내시경만 유지한다.
  const dateLocked = Boolean(appointment.sameDay);
  const procedureLocked = Boolean(appointment.sameDay);
  // 연장 슬롯 예약은 승인된 그 30분에 묶여 있다.
  const timeLocked = bucket === "SAME_DAY_EXTENSION";

  const { serviceDate, procedure, procedureSet } = change;
  const slotKey = `${serviceDate}|${procedure}|${procedureSet}|${slotRevision}`;

  useEffect(() => {
    if (timeLocked) return;
    let cancelled = false;
    void appointmentsApi
      .changeAvailability(appointment, {
        ...appointmentChangeFrom(appointment),
        serviceDate,
        procedure,
        procedureSet,
      })
      .then((response) => {
        if (cancelled) return;
        setSlots({
          key: slotKey,
          starts: response.slots.map((slot) => slot.start_time.slice(0, 5)),
          error: "",
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setSlots({
          key: slotKey,
          starts: [],
          error:
            cause instanceof Error ? cause.message : "가능 시간을 조회하지 못했습니다.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [appointment, serviceDate, procedure, procedureSet, slotKey, timeLocked]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, pending]);

  const slotsLoading = !timeLocked && slots?.key !== slotKey;
  const starts = slots?.key === slotKey ? slots.starts : [];
  // 고른 시각이 아직 가능하면 그대로 두고, 아니면 첫 가능 시각을 쓴다.
  const effectiveStart = timeLocked
    ? change.startTime
    : starts.includes(change.startTime)
      ? change.startTime
      : (starts[0] ?? "");
  const canSubmit =
    !pending && reason.trim().length > 0 && (timeLocked || effectiveStart !== "");

  const patch = (next: Partial<AppointmentChange>) => {
    setChange((current) => ({ ...current, ...next }));
    setError("");
  };

  const submit = async () => {
    if (!reason.trim()) {
      setError("변경 사유를 입력해 주세요.");
      reasonRef.current?.focus();
      return;
    }
    if (!csrfToken) {
      setError("보안 세션이 없어 저장할 수 없습니다. 다시 로그인해 주세요.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await appointmentsApi.change(
        appointment,
        { ...change, startTime: effectiveStart },
        reason,
        csrfToken,
      );
      onDone(`${appointment.name}님의 예약을 변경했습니다.`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "STALE_ROW_VERSION") {
        onStale(cause.message);
        return;
      }
      if (cause instanceof ApiError && cause.code && RETRY_WITH_FRESH_SLOTS.has(cause.code)) {
        setSlotRevision((current) => current + 1);
      }
      setError(cause instanceof Error ? cause.message : "예약을 변경하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  const isCurrentSlot = (start: string) =>
    start === appointment.start && change.serviceDate === appointment.date;

  return (
    <div className="modal-backdrop" onMouseDown={() => !pending && onClose()}>
      <section
        className="schedule-action-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-change-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="schedule-action-dialog__header">
          <div>
            <p>
              {appointment.name} · {appointment.chartNumber}
            </p>
            <h2 id="appointment-change-title">예약 변경</h2>
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
          <p className="schedule-action-dialog__notice">
            현재 {koreanDateLabel(appointment.date)} {appointment.start} ·{" "}
            {appointment.procedure}. 같은 예약의 새 Revision으로 저장되고 변경 전후 값이
            이력에 남습니다.
            {dateLocked ? " 당일 예약은 오늘 안에서만 바꿀 수 있습니다." : ""}
            {timeLocked ? " 연장 슬롯 예약은 승인된 시각에 묶여 있습니다." : ""}
          </p>

          <label className="field">
            <span>검사 예정일</span>
            <input
              type="date"
              value={change.serviceDate}
              disabled={dateLocked || pending}
              onChange={(event) =>
                event.target.value && patch({ serviceDate: event.target.value })
              }
            />
          </label>

          <fieldset className="field">
            <legend>검사</legend>
            <div className="schedule-action-dialog__choices">
              {PROCEDURE_OPTIONS.map((option) => (
                <label key={option}>
                  <input
                    type="radio"
                    name="change-procedure"
                    checked={change.procedure === option}
                    disabled={procedureLocked || pending}
                    onChange={() => patch({ procedure: option })}
                  />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>

          {change.procedure === "위·대장" && (
            <fieldset className="field">
              <legend>동시검사 세트</legend>
              <div className="schedule-action-dialog__choices">
                {(["세트60", "세트90"] as const).map((option) => (
                  <label key={option}>
                    <input
                      type="radio"
                      name="change-set"
                      checked={change.procedureSet === option}
                      disabled={pending}
                      onChange={() => patch({ procedureSet: option })}
                    />
                    {option === "세트60" ? "세트60 (60분)" : "세트90 (90분)"}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="field">
            <legend>수면·진료 구분</legend>
            <div className="schedule-action-dialog__choices">
              {change.procedure !== "대장" && (
                <label>
                  <input
                    type="checkbox"
                    checked={change.upperSedation}
                    disabled={pending}
                    onChange={(event) => patch({ upperSedation: event.target.checked })}
                  />
                  위 수면
                </label>
              )}
              {change.procedure !== "위" && (
                <label>
                  <input
                    type="checkbox"
                    checked={change.colonSedation}
                    disabled={pending}
                    onChange={(event) => patch({ colonSedation: event.target.checked })}
                  />
                  대장 수면
                </label>
              )}
              {CARE_OPTIONS.map((option) => (
                <label key={option}>
                  <input
                    type="radio"
                    name="change-care"
                    checked={change.careCategory === option}
                    disabled={pending}
                    onChange={() => patch({ careCategory: option })}
                  />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend>시작 시각</legend>
            {timeLocked ? (
              <p className="field-note">{change.startTime} (승인된 연장 슬롯)</p>
            ) : slotsLoading ? (
              <p className="field-note">가능 시간을 조회하는 중입니다.</p>
            ) : slots?.error ? (
              <p className="schedule-action-dialog__error" role="alert">
                {slots.error}
              </p>
            ) : starts.length === 0 ? (
              <p className="schedule-action-dialog__error" role="alert">
                선택한 날짜와 검사로는 가능한 시간이 없습니다.
              </p>
            ) : (
              <div className="slot-picker">
                {starts.map((start) => (
                  <button
                    type="button"
                    key={start}
                    className={
                      effectiveStart === start ? "is-selected is-available" : "is-available"
                    }
                    disabled={pending}
                    onClick={() => patch({ startTime: start })}
                  >
                    <strong>{start}</strong>
                    <small>{isCurrentSlot(start) ? "현재" : "가능"}</small>
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <label className="field">
            <span>변경 사유 (필수)</span>
            <textarea
              ref={reasonRef}
              rows={2}
              maxLength={500}
              value={reason}
              disabled={pending}
              placeholder="예: 환자 요청으로 시간 변경"
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
            className="primary-button"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            <Icon name="check" />
            {pending ? "저장 중" : "변경 저장"}
          </button>
        </footer>
      </section>
    </div>
  );
}
