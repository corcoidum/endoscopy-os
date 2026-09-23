import { useEffect, useState } from "react";
import { appointmentsApi } from "./appointmentsApi";
import { addCalendarDays, seoulTodayIso } from "./calendarDates";
import { formatAgeSex, procedureLabel, type Appointment } from "./data";
import { Icon } from "./icons";
import { EmptyState } from "./uiPrimitives";
import { VERIFICATION_STATE_LABELS } from "./verificationsApi";
import {
  MEDICATION_QUEUE_ORDER,
  MEDICATION_STATE_LABELS,
  MEDICATION_STATE_TONES,
} from "./medicationsApi";
import {
  VERIFICATION_QUEUE_ORDER,
  medicationQueue,
  verificationQueue,
} from "./appointmentPresentation";

// 오늘부터 이 기간의 실제 예약에서 확인 대기를 모은다(목록 조회 한도 42일 안).
export const VERIFICATION_QUEUE_DAYS = 14;

type QueueResult = { key: string; items: Appointment[]; error: string };

/** 오늘부터 VERIFICATION_QUEUE_DAYS일 동안의 실제 예약을 불러온다. */
function useQueueAppointments(
  revision: number,
  onLoaded: (appointments: Appointment[]) => void,
) {
  const [result, setResult] = useState<QueueResult | null>(null);
  const startDate = seoulTodayIso();
  const endDate = addCalendarDays(startDate, VERIFICATION_QUEUE_DAYS - 1);
  const key = `${startDate}|${endDate}|${revision}`;

  useEffect(() => {
    let cancelled = false;
    void appointmentsApi
      .list(startDate, endDate)
      .then((items) => {
        if (cancelled) return;
        setResult({ key, items, error: "" });
        onLoaded(items);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setResult({
          key,
          items: [],
          error: cause instanceof Error ? cause.message : "확인 대기 예약을 불러오지 못했습니다.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, key, onLoaded]);

  const loaded = result?.key === key;
  return {
    startDate,
    loaded,
    items: loaded ? result.items : [],
    error: loaded ? result.error : "",
  };
}

function QueueTable({
  label,
  items,
  stateLabel,
  stateTone,
  onOpen,
}: {
  label: string;
  items: Appointment[];
  stateLabel: (appointment: Appointment) => string;
  stateTone: (appointment: Appointment) => string;
  onOpen: (appointment: Appointment) => void;
}) {
  return (
    <div className="table-card">
      <div className="data-table data-table--verification" role="list" aria-label={label}>
        <div className="data-table__head">
          <span>일시</span>
          <span>환자</span>
          <span>나이 · 성별</span>
          <span>검사</span>
          <span>확인 상태</span>
          <span>작업</span>
        </div>
        {items.map((appointment) => (
          <button
            type="button"
            role="listitem"
            className="data-table__row"
            key={appointment.id}
            onClick={() => onOpen(appointment)}
          >
            <span>
              {appointment.date.slice(5)} {appointment.start}
            </span>
            <span>
              <strong>{appointment.name}</strong>
              <small>{appointment.chartNumber}</small>
            </span>
            <span>{formatAgeSex(appointment)}</span>
            <span>{procedureLabel(appointment)}</span>
            <span className={`verification-state verification-state--${stateTone(appointment)}`}>
              {stateLabel(appointment)}
            </span>
            <span className="row-action">
              <Icon name="shield" />
              확인 열기
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 확인 업무 화면. 실제 예약의 인적사항 이중확인과 대장내시경 복용약 확인 대기만 보여 준다.
 * D-1 연락은 아직 실제 기록과 연결하지 않아 이 목록에 섞지 않는다.
 */
export function VerificationQueueView({
  revision,
  canReadMedication,
  onOpen,
  onOpenMedication,
  onLoaded,
}: {
  revision: number;
  canReadMedication: boolean;
  onOpen: (appointment: Appointment) => void;
  onOpenMedication: (appointment: Appointment) => void;
  onLoaded: (appointments: Appointment[]) => void;
}) {
  const { loaded, items, error } = useQueueAppointments(revision, onLoaded);
  const queue = verificationQueue(items);
  const medications = medicationQueue(items);
  const verifiedCount = items.filter((item) => item.verificationState === "VERIFIED").length;
  const medicationDoneCount = items.filter((item) => item.medicationState === "COMPLETE").length;

  return (
    <section className="view-surface">
      <div className="view-title">
        <div>
          <span className="eyebrow">확인 업무 · 오늘부터 {VERIFICATION_QUEUE_DAYS}일 실제 예약</span>
          <h1>확인 업무 대기</h1>
          <p>
            인적사항 1·2차 확인{canReadMedication ? "과 대장내시경 복용약 확인" : ""}이 끝나지 않은
            실제 예약입니다. D-1 연락은 아직 연결하지 않아 이 목록에 포함하지 않습니다.
          </p>
        </div>
      </div>

      {!loaded ? (
        <p className="field-note">확인 대기 예약을 불러오는 중입니다.</p>
      ) : error ? (
        <p className="schedule-action-dialog__error" role="alert">
          {error}
        </p>
      ) : (
        <>
          <section className="confirmation-section" aria-label="이중확인 대기 현황">
            <h2>인적사항 이중확인</h2>
            <div className="verification-queue-summary" aria-label="이중확인 현황">
              {VERIFICATION_QUEUE_ORDER.map((state) => (
                <span key={state}>
                  {VERIFICATION_STATE_LABELS[state]}{" "}
                  <strong>{items.filter((item) => item.verificationState === state).length}</strong>
                </span>
              ))}
              <span>
                {VERIFICATION_STATE_LABELS.VERIFIED} <strong>{verifiedCount}</strong>
              </span>
            </div>
            {queue.length === 0 ? (
              <EmptyState
                title="이중확인 대기 예약이 없습니다."
                description="기간 안의 실제 예약은 모두 1·2차 확인을 마쳤습니다."
              />
            ) : (
              <QueueTable
                label="이중확인 대기 목록"
                items={queue}
                stateLabel={(appointment) =>
                  appointment.verificationState
                    ? VERIFICATION_STATE_LABELS[appointment.verificationState]
                    : ""
                }
                stateTone={(appointment) =>
                  appointment.verificationState === "REVERIFY_REQUIRED" ? "danger" : "warning"
                }
                onOpen={onOpen}
              />
            )}
          </section>

          {canReadMedication && (
            <section className="confirmation-section" aria-label="복용약 확인 대기 현황">
              <h2>대장내시경 복용약</h2>
              <div className="verification-queue-summary" aria-label="복용약 확인 현황">
                {MEDICATION_QUEUE_ORDER.map((state) => (
                  <span key={state}>
                    {MEDICATION_STATE_LABELS[state]}{" "}
                    <strong>{items.filter((item) => item.medicationState === state).length}</strong>
                  </span>
                ))}
                <span>
                  {MEDICATION_STATE_LABELS.COMPLETE} <strong>{medicationDoneCount}</strong>
                </span>
              </div>
              {medications.length === 0 ? (
                <EmptyState
                  title="복용약 확인 대기 예약이 없습니다."
                  description="기간 안의 대장내시경 예약은 복용약 확인과 의사 결정 안내를 마쳤습니다."
                />
              ) : (
                <QueueTable
                  label="약제 확인 대기 목록"
                  items={medications}
                  stateLabel={(appointment) =>
                    appointment.medicationState
                      ? MEDICATION_STATE_LABELS[appointment.medicationState]
                      : ""
                  }
                  stateTone={(appointment) =>
                    appointment.medicationState
                      ? MEDICATION_STATE_TONES[appointment.medicationState]
                      : "warning"
                  }
                  onOpen={onOpenMedication}
                />
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}

function PriorityCard({
  label,
  icon,
  tone,
  count,
  target,
  stateLabel,
  selected,
  startDate,
  onOpen,
}: {
  label: string;
  icon: string;
  tone: string;
  count: number;
  target: Appointment;
  stateLabel: string;
  selected: boolean;
  startDate: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`queue-card queue-card--${tone} ${selected ? "is-selected" : ""}`}
      onClick={onOpen}
    >
      <span className="queue-card__icon">
        <Icon name={icon} />
      </span>
      <span className="queue-card__body">
        <span className="queue-card__top">
          <strong>{label}</strong>
          <span className="count-badge">{count}</span>
        </span>
        <span className="queue-card__patient">
          <strong>{target.start}</strong>
          <span>{target.name}</span>
          <small>{target.chartNumber}</small>
        </span>
        <span className="queue-card__meta">{formatAgeSex(target)}</span>
        <span className="queue-card__meta">
          {target.date === startDate ? "오늘" : target.date.slice(5)}
          {stateLabel ? ` · ${stateLabel}` : ""}
        </span>
      </span>
      <Icon name="chevron" className="queue-card__chevron" />
    </button>
  );
}

/**
 * 주간 보드 왼쪽 업무 Queue. 확인 업무 화면과 같은 실제 예약의 이중확인·복용약 대기만 보여 준다.
 * D-1 연락·예약금은 아직 실제 기록과 연결하지 않아 Prototype 값을 섞지 않는다.
 */
export function VerificationPriorityQueue({
  revision,
  selectedId,
  canReadMedication,
  onOpen,
  onOpenMedication,
  onLoaded,
  onRefresh,
  onOpenAll,
}: {
  revision: number;
  selectedId?: string;
  canReadMedication: boolean;
  onOpen: (appointment: Appointment) => void;
  onOpenMedication: (appointment: Appointment) => void;
  onLoaded: (appointments: Appointment[]) => void;
  onRefresh: () => void;
  onOpenAll?: () => void;
}) {
  const { startDate, loaded, items, error } = useQueueAppointments(revision, onLoaded);
  const queue = verificationQueue(items);
  const medications = canReadMedication ? medicationQueue(items) : [];
  const target = queue[0];
  const medicationTarget = medications[0];

  return (
    <aside className="priority-queue" aria-label="오늘 우선 처리">
      <div className="section-heading">
        <div>
          <span className="eyebrow">업무 Queue</span>
          <h2>오늘 우선 처리</h2>
        </div>
        <div className="inline-actions">
          <button type="button" className="icon-button" title="Queue 새로고침" onClick={onRefresh}>
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      <div className="queue-list">
        {!loaded ? (
          <p className="field-note">확인 대기를 불러오는 중입니다.</p>
        ) : error ? (
          <p className="schedule-action-dialog__error" role="alert">
            {error}
          </p>
        ) : (
          <>
            {target ? (
              <PriorityCard
                label="이중확인"
                icon="warning"
                tone="orange"
                count={queue.length}
                target={target}
                stateLabel={
                  target.verificationState ? VERIFICATION_STATE_LABELS[target.verificationState] : ""
                }
                selected={selectedId === target.id}
                startDate={startDate}
                onOpen={() => onOpen(target)}
              />
            ) : (
              <p className="field-note">
                오늘부터 {VERIFICATION_QUEUE_DAYS}일 동안 이중확인 대기 예약이 없습니다.
              </p>
            )}
            {canReadMedication &&
              (medicationTarget ? (
                <PriorityCard
                  label="복용약 확인"
                  icon="medication"
                  tone="violet"
                  count={medications.length}
                  target={medicationTarget}
                  stateLabel={
                    medicationTarget.medicationState
                      ? MEDICATION_STATE_LABELS[medicationTarget.medicationState]
                      : ""
                  }
                  selected={selectedId === medicationTarget.id}
                  startDate={startDate}
                  onOpen={() => onOpenMedication(medicationTarget)}
                />
              ) : (
                <p className="field-note">
                  오늘부터 {VERIFICATION_QUEUE_DAYS}일 동안 복용약 확인 대기 예약이 없습니다.
                </p>
              ))}
          </>
        )}
        <p className="unconnected-note">
          D-1 연락·예약금은 아직 실제 기록과 연결하지 않아 표시하지 않습니다.
        </p>
      </div>

      {onOpenAll && (
        <button type="button" className="queue-more" onClick={onOpenAll}>
          모든 확인 업무 보기
          <Icon name="chevron" />
        </button>
      )}

      <div className="queue-safety-note">
        <Icon name="shield" />
        <span>
          <strong>합성 데이터 Prototype</strong>
          실제 환자정보는 입력하지 않습니다.
        </span>
      </div>
    </aside>
  );
}
