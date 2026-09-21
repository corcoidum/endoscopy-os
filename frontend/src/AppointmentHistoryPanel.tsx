import { useEffect, useState } from "react";
import {
  appointmentsApi,
  type AppointmentHistoryEvent,
} from "./appointmentsApi";
import { describeHistoryChanges, EVENT_LABELS } from "./appointmentPresentation";

const OCCURRED_AT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

type HistoryResult = { key: string; events: AppointmentHistoryEvent[]; error: string };

/** Backend에 쌓인 예약 이력을 시간순으로 보여 준다. */
export function AppointmentHistoryPanel({
  appointmentId,
  revision,
}: {
  appointmentId: string;
  /** 예약이 바뀌면 다시 불러오도록 row_version을 받는다. */
  revision: number | undefined;
}) {
  const key = `${appointmentId}:${revision ?? 0}`;
  const [result, setResult] = useState<HistoryResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void appointmentsApi
      .history(appointmentId)
      .then((events) => {
        if (!cancelled) setResult({ key, events, error: "" });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setResult({
          key,
          events: [],
          error: cause instanceof Error ? cause.message : "이력을 불러오지 못했습니다.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, key]);

  if (result?.key !== key) {
    return <p className="field-note">예약 이력을 불러오는 중입니다.</p>;
  }
  if (result.error) {
    return (
      <p className="schedule-action-dialog__error" role="alert">
        {result.error}
      </p>
    );
  }
  if (result.events.length === 0) {
    return <p className="field-note">기록된 이력이 없습니다.</p>;
  }
  return (
    <ol className="appointment-history" aria-label="예약 이력">
      {result.events.map((event) => {
        const changes = describeHistoryChanges(event);
        return (
          <li key={event.id}>
            <div className="appointment-history__head">
              <strong>{EVENT_LABELS[event.event_type]}</strong>
              <time dateTime={event.occurred_at}>
                {OCCURRED_AT.format(new Date(event.occurred_at))}
              </time>
            </div>
            <p className="appointment-history__reason">{event.reason}</p>
            {changes.length > 0 && (
              <ul className="appointment-history__changes">
                {changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
