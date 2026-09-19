import type { Appointment, CheckState } from "./data";
import { Icon } from "./icons";

export function checkTone(state: CheckState) {
  if (state === "완료") return "success";
  if (state === "불필요") return "neutral";
  return "warning";
}

export function procedureTone(procedure: Appointment["procedure"]) {
  if (procedure === "위") return "upper";
  if (procedure === "대장") return "colon";
  return "combined";
}

export function AppStatusMark({
  icon,
  state,
  label,
}: {
  icon: string;
  state: CheckState;
  label: string;
}) {
  return (
    <span
      className={`status-mark status-mark--${checkTone(state)}`}
      title={`${label}: ${state}`}
      aria-label={`${label} ${state}`}
    >
      <Icon name={state === "대기" ? "warning" : icon} />
      <span className="sr-only">{`${label} ${state}`}</span>
    </span>
  );
}

export function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <Icon name="add" />
    </div>
  );
}

export function StateLabel({ state }: { state: CheckState }) {
  return (
    <span className={`state-label state-label--${checkTone(state)}`}>
      <Icon name={state === "대기" ? "warning" : "check"} />
      {state}
    </span>
  );
}

export function CheckCard({
  label,
  checked,
  warning = false,
}: {
  label: string;
  checked: boolean;
  warning?: boolean;
}) {
  return (
    <div className={`check-card ${warning ? "is-warning" : ""}`}>
      <Icon name={checked ? "check" : warning ? "warning" : "close"} />
      <span>{label}</span>
      <strong>{checked ? "완료" : warning ? "확인 필요" : "해당 없음"}</strong>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <Icon name="info" />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}
