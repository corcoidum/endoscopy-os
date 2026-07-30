import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  WEEK_DAYS,
  calculateAge,
  formatAgeSex,
  initialAppointments,
  initialPathologyCases,
  procedureLabel,
  type Appointment,
  type CheckState,
  type PathologyCase,
} from "./data";
import {
  fromMinutes,
  getDateBlocks,
  isShortMorning,
  procedureDuration,
  standardStartsFor,
  toMinutes,
  validateBooking,
  type BookingDraft,
  type ValidationResult,
} from "./scheduler";

type ViewId =
  | "today"
  | "month"
  | "week"
  | "day"
  | "confirmation"
  | "pathology"
  | "patient"
  | "statistics"
  | "admin";

type DrawerState =
  | { kind: "appointment"; id: string }
  | { kind: "pathology"; id: string }
  | null;

const ICONS: Record<string, string> = {
  today: "\uE823",
  month: "\uE787",
  week: "\uE787",
  day: "\uE787",
  add: "\uE710",
  confirmation: "\uE9D5",
  pathology: "\uE9F9",
  patient: "\uE716",
  statistics: "\uE9D2",
  admin: "\uE713",
  search: "\uE721",
  previous: "\uE76B",
  next: "\uE76C",
  bell: "\uEA8F",
  logout: "\uE7E8",
  filter: "\uE71C",
  refresh: "\uE72C",
  warning: "\uE7BA",
  check: "\uE73E",
  phone: "\uE717",
  medication: "\uE8E5",
  deposit: "\uE8C7",
  close: "\uE711",
  edit: "\uE70F",
  detail: "\uE8A7",
  shield: "\uEA18",
  print: "\uE749",
  lock: "\uE72E",
  chevron: "\uE76C",
  clock: "\uE823",
  history: "\uE81C",
  info: "\uE946",
  menu: "\uE700",
};

const NAVIGATION: Array<{
  id: ViewId | "booking";
  label: string;
  icon: string;
}> = [
  { id: "today", label: "오늘", icon: "today" },
  { id: "month", label: "월간", icon: "month" },
  { id: "week", label: "주간", icon: "week" },
  { id: "day", label: "일간", icon: "day" },
  { id: "booking", label: "예약 등록", icon: "add" },
  { id: "confirmation", label: "확인 업무", icon: "confirmation" },
  { id: "pathology", label: "조직검체", icon: "pathology" },
  { id: "patient", label: "환자 History", icon: "patient" },
  { id: "statistics", label: "통계", icon: "statistics" },
  { id: "admin", label: "관리자", icon: "admin" },
];

const WIZARD_STEPS = [
  "환자 확인",
  "검사 종류와 일정",
  "검진 정보",
  "장정결제",
  "복용약·수술이력",
  "추가 검사",
  "예약금",
  "최종 확인",
];

function Icon({
  name,
  className = "",
  label,
}: {
  name: string;
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={`fluent-icon ${className}`}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      {ICONS[name] ?? ICONS.info}
    </span>
  );
}

function formatDateKorean(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function checkTone(state: CheckState) {
  if (state === "완료") return "success";
  if (state === "불필요") return "neutral";
  return "warning";
}

function procedureTone(procedure: Appointment["procedure"]) {
  if (procedure === "위") return "upper";
  if (procedure === "대장") return "colon";
  return "combined";
}

function AppStatusMark({
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

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <Icon name="add" />
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-card__brand">
          <BrandMark />
          <div>
            <strong>내시경 운영 시스템</strong>
            <span>Clinic Endoscopy Operations</span>
          </div>
        </div>
        <div className="login-card__intro">
          <span className="eyebrow">원내 내부망 전용</span>
          <h1 id="login-title">직원 로그인</h1>
          <p>등록된 ID와 Password를 입력하세요.</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onLogin();
          }}
        >
          <label className="field">
            <span>ID</span>
            <input defaultValue="admin.demo" autoComplete="username" autoFocus />
          </label>
          <label className="field">
            <span>Password</span>
            <span className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                defaultValue="prototype"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="text-button"
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? "숨김" : "표시"}
              </button>
            </span>
          </label>
          <div className="login-card__notice">
            <Icon name="clock" />
            <span>30분 동안 사용하지 않으면 자동 로그아웃됩니다.</span>
          </div>
          <button className="primary-button primary-button--wide" type="submit">
            로그인
          </button>
        </form>
        <p className="prototype-note">
          합성 데이터 Prototype · 실제 환자정보를 입력하지 마세요.
        </p>
      </section>
    </main>
  );
}

function PriorityQueue({
  appointments,
  onSelect,
  selectedId,
}: {
  appointments: Appointment[];
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  const queueDefinitions = [
    {
      key: "verification",
      label: "이중확인",
      icon: "warning",
      tone: "orange",
      ids: appointments
        .filter(
          (appointment) =>
            appointment.date === "2026-07-30" &&
            appointment.verification === "대기",
        )
        .map((appointment) => appointment.id),
    },
    {
      key: "medication",
      label: "약제확인",
      icon: "medication",
      tone: "violet",
      ids: appointments
        .filter((appointment) => appointment.medication === "대기")
        .map((appointment) => appointment.id),
    },
    {
      key: "d1",
      label: "D-1 재연락",
      icon: "phone",
      tone: "blue",
      ids: appointments
        .filter((appointment) => appointment.d1 === "대기")
        .map((appointment) => appointment.id),
    },
    {
      key: "deposit",
      label: "예약금",
      icon: "deposit",
      tone: "green",
      ids: appointments
        .filter((appointment) => appointment.deposit === "대기")
        .map((appointment) => appointment.id),
    },
  ];

  return (
    <aside className="priority-queue" aria-label="오늘 우선 처리">
      <div className="section-heading">
        <div>
          <span className="eyebrow">업무 Queue</span>
          <h2>오늘 우선 처리</h2>
        </div>
        <div className="inline-actions">
          <button className="icon-button" title="Queue 필터">
            <Icon name="filter" />
          </button>
          <button className="icon-button" title="Queue 새로고침">
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      <div className="queue-list">
        {queueDefinitions.map((queue) => {
          const target = appointments.find(
            (appointment) => appointment.id === queue.ids[0],
          );
          if (!target) return null;

          return (
            <button
              className={`queue-card queue-card--${queue.tone} ${
                selectedId === target.id ? "is-selected" : ""
              }`}
              key={queue.key}
              onClick={() => onSelect(target.id)}
            >
              <span className="queue-card__icon">
                <Icon name={queue.icon} />
              </span>
              <span className="queue-card__body">
                <span className="queue-card__top">
                  <strong>{queue.label}</strong>
                  <span className="count-badge">{queue.ids.length}</span>
                </span>
                <span className="queue-card__patient">
                  <strong>{target.start}</strong>
                  <span>{target.name}</span>
                  <small>{target.chartNumber}</small>
                </span>
                <span className="queue-card__meta">
                  {formatAgeSex(target)}
                </span>
              </span>
              <Icon name="chevron" className="queue-card__chevron" />
            </button>
          );
        })}
      </div>

      <button className="queue-more">
        모든 확인 업무 보기
        <Icon name="chevron" />
      </button>

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

function AppointmentCard({
  appointment,
  selected,
  onSelect,
}: {
  appointment: Appointment;
  selected: boolean;
  onSelect: () => void;
}) {
  const isAfternoon = Boolean(appointment.afternoonException);
  const slotIndex =
    appointment.start === "14:00"
      ? 0
      : (toMinutes(appointment.start) - 9 * 60) / 30;
  const style = {
    "--slot-index": slotIndex,
    "--slot-span": appointment.duration / 30,
  } as CSSProperties;
  const end = fromMinutes(toMinutes(appointment.start) + appointment.duration);

  return (
    <button
      className={`appointment-card appointment-card--${procedureTone(
        appointment.procedure,
      )} ${isAfternoon ? "appointment-card--afternoon" : ""} ${
        selected ? "is-selected" : ""
      }`}
      style={style}
      onClick={onSelect}
      aria-label={`${appointment.start}부터 ${end}, ${appointment.name}, ${
        appointment.chartNumber
      }, ${formatAgeSex(appointment)}, ${procedureLabel(appointment)}`}
    >
      <span className="appointment-card__time">
        {appointment.start}–{end}
        {isAfternoon && <span className="mini-tag">예외</span>}
      </span>
      <span className="appointment-card__identity">
        <strong title={appointment.name}>{appointment.name}</strong>
        <small title={appointment.chartNumber}>{appointment.chartNumber}</small>
      </span>
      <span className="appointment-card__procedure">
        <span className={`procedure-chip procedure-chip--${procedureTone(appointment.procedure)}`}>
          {procedureLabel(appointment)}
        </span>
      </span>
      <span className="appointment-card__demographic">
        {formatAgeSex(appointment)}
      </span>
      <span className="appointment-card__status">
        <AppStatusMark icon="medication" state={appointment.medication} label="약제" />
        <AppStatusMark icon="phone" state={appointment.d1} label="D-1" />
        <AppStatusMark icon="check" state={appointment.verification} label="이중확인" />
        <AppStatusMark icon="deposit" state={appointment.deposit} label="예약금" />
      </span>
    </button>
  );
}

function TimeAxis() {
  const morningTimes = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"];
  return (
    <div className="time-axis" aria-hidden="true">
      {morningTimes.map((time, index) => (
        <span
          key={time}
          className="time-axis__label"
          style={{ "--slot-index": index } as CSSProperties}
        >
          {time}
        </span>
      ))}
      <span className="time-axis__label time-axis__label--afternoon">14:00</span>
    </div>
  );
}

function WeekSchedule({
  appointments,
  selectedId,
  onSelect,
  search,
}: {
  appointments: Appointment[];
  selectedId?: string;
  onSelect: (id: string) => void;
  search: string;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const filteredAppointments = normalizedSearch
    ? appointments.filter(
        (appointment) =>
          appointment.name.toLowerCase().includes(normalizedSearch) ||
          appointment.chartNumber.toLowerCase().includes(normalizedSearch),
      )
    : appointments;

  return (
    <section className="schedule-panel" aria-label="월요일부터 토요일 주간 일정">
      <div className="print-title">
        <strong>내시경 주간 일정</strong>
        <span>2026-07-27 ~ 2026-08-01 · 원내업무용 · 사용 후 파쇄</span>
      </div>
      <div className="week-board">
        <div className="week-board__corner">시간</div>
        {WEEK_DAYS.map((day) => {
          const dayAppointments = appointments.filter(
            (appointment) => appointment.date === day.date,
          );
          const upperCount = dayAppointments.filter(
            (appointment) =>
              appointment.procedure === "위" ||
              appointment.procedure === "위·대장",
          ).length;
          const colonCount = dayAppointments.filter(
            (appointment) =>
              appointment.procedure === "대장" ||
              appointment.procedure === "위·대장",
          ).length;

          return (
            <div
              className={`day-heading ${day.today ? "is-today" : ""}`}
              key={day.date}
            >
              <span>
                {day.label}
                {day.today && <em>오늘</em>}
              </span>
              <small>
                환자 {dayAppointments.length} · 위 {upperCount} · 대장 {colonCount}
              </small>
              {getDateBlocks(day.date).length > 0 && (
                <span className="override-label">
                  <Icon name="warning" />
                  10:30 점검 차단
                </span>
              )}
            </div>
          );
        })}
        <TimeAxis />
        {WEEK_DAYS.map((day) => {
          const dayAppointments = filteredAppointments.filter(
            (appointment) => appointment.date === day.date,
          );
          return (
            <div
              className={`day-column ${day.today ? "is-today" : ""}`}
              key={day.date}
            >
              <div className="slot-lines" aria-hidden="true">
                {Array.from({ length: 7 }, (_, index) => (
                  <span
                    style={{ "--slot-index": index } as CSSProperties}
                    key={index}
                  />
                ))}
              </div>
              {isShortMorning(day.date) && (
                <div className="closed-morning">
                  <Icon name="lock" />
                  <span>11:00 오전 운영 종료</span>
                </div>
              )}
              {getDateBlocks(day.date).map((block) => (
                <div className="blocked-slot" key={`${day.date}-${block.start}`}>
                  <Icon name="warning" />
                  <span>점검 차단</span>
                </div>
              ))}
              {dayAppointments.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  selected={selectedId === appointment.id}
                  onSelect={() => onSelect(appointment.id)}
                />
              ))}
              {day.date === "2026-08-01" && (
                <div className="validation-example" aria-label="수토 검증 예시">
                  <strong>10:30 대장 선택 불가</strong>
                  <span>종료 11:30 · 운영시간 초과</span>
                  <small>가장 빠른 대안: 14:00 예외</small>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Inspector({
  appointment,
  onOpen,
  onEdit,
  onVerify,
}: {
  appointment?: Appointment;
  onOpen: () => void;
  onEdit: () => void;
  onVerify: () => void;
}) {
  if (!appointment) {
    return (
      <section className="inspector inspector--empty">
        예약 카드를 선택하면 핵심 확인 상태가 표시됩니다.
      </section>
    );
  }

  const age = calculateAge(
    appointment.dateOfBirth,
    appointment.date,
    appointment.careCategory,
  );

  return (
    <section className="inspector" aria-label="선택 예약 Inspector">
      <div className="inspector__accent" />
      <div className="inspector__identity">
        <span className="eyebrow">선택됨</span>
        <div className="patient-heading">
          <span className="avatar">{appointment.name.slice(0, 1)}</span>
          <div>
            <h2>
              {appointment.name}
              <span className="demographic-badge">
                {appointment.careCategory === "검진" ? age : `만 ${age}`} ·{" "}
                {appointment.sex}
              </span>
            </h2>
            <p>
              {appointment.chartNumber}
              <span>·</span>
              {appointment.careCategory}
            </p>
          </div>
        </div>
        <button className="secondary-button" onClick={onOpen}>
          <Icon name="patient" />
          환자 상세
        </button>
      </div>

      <div className="inspector__section">
        <span className="inspector__title">예약 정보</span>
        <dl className="compact-definition">
          <div>
            <dt>일시</dt>
            <dd>
              {formatDateKorean(appointment.date)} {appointment.start} ·{" "}
              {appointment.duration}분
            </dd>
          </div>
          <div>
            <dt>검사</dt>
            <dd>{procedureLabel(appointment)}</dd>
          </div>
          <div>
            <dt>유형</dt>
            <dd>{appointment.careCategory}</dd>
          </div>
          {appointment.afternoonException && (
            <div>
              <dt>구분</dt>
              <dd>
                <span className="inline-badge inline-badge--exception">
                  오후 예외
                </span>
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="inspector__section">
        <span className="inspector__title">핵심 확인 상태</span>
        <ul className="check-list">
          <li>
            <Icon name="medication" />
            약제확인
            <StateLabel state={appointment.medication} />
          </li>
          <li>
            <Icon name="phone" />
            D-1 확인
            <StateLabel state={appointment.d1} />
          </li>
          <li>
            <Icon name="shield" />
            이중확인
            <StateLabel state={appointment.verification} />
          </li>
          <li>
            <Icon name="deposit" />
            예약금
            <StateLabel state={appointment.deposit} />
          </li>
        </ul>
      </div>

      <div className="inspector__section inspector__section--preparation">
        <span className="inspector__title">준비 / 안내</span>
        <dl className="compact-definition">
          <div>
            <dt>장정결</dt>
            <dd>{appointment.bowelPreparation ?? "해당 없음"}</dd>
          </div>
          <div>
            <dt>본인부담</dt>
            <dd>{appointment.screeningCopay ?? "해당 없음"}</dd>
          </div>
          <div>
            <dt>PACS</dt>
            <dd>
              <StateLabel state={appointment.pacs} />
            </dd>
          </div>
        </dl>
      </div>

      <div className="inspector__actions">
        <span className="inspector__title">빠른 작업</span>
        <button className="secondary-button secondary-button--wide" onClick={onOpen}>
          <Icon name="detail" />
          상세 열기
          <kbd>Enter</kbd>
        </button>
        <button className="secondary-button secondary-button--wide" onClick={onEdit}>
          <Icon name="edit" />
          예약 변경
          <kbd>F4</kbd>
        </button>
        <button className="primary-button primary-button--wide" onClick={onVerify}>
          <Icon name="check" />
          2차 확인
          <kbd>F6</kbd>
        </button>
      </div>
    </section>
  );
}

function StateLabel({ state }: { state: CheckState }) {
  return (
    <span className={`state-label state-label--${checkTone(state)}`}>
      <Icon name={state === "대기" ? "warning" : "check"} />
      {state}
    </span>
  );
}

function DashboardMetrics({
  appointments,
  pathologyCases,
}: {
  appointments: Appointment[];
  pathologyCases: PathologyCase[];
}) {
  const todayAppointments = appointments.filter(
    (appointment) => appointment.date === "2026-07-30",
  );
  const metrics = [
    { label: "오늘 환자", value: todayAppointments.length, tone: "indigo" },
    {
      label: "위 건수",
      value: todayAppointments.filter(
        (item) => item.procedure === "위" || item.procedure === "위·대장",
      ).length,
      tone: "blue",
    },
    {
      label: "대장 건수",
      value: todayAppointments.filter(
        (item) => item.procedure === "대장" || item.procedure === "위·대장",
      ).length,
      tone: "violet",
    },
    {
      label: "오후 예외",
      value: todayAppointments.filter((item) => item.afternoonException).length,
      tone: "orange",
    },
    {
      label: "이중확인 미완료",
      value: todayAppointments.filter((item) => item.verification === "대기")
        .length,
      tone: "orange",
    },
    {
      label: "약제 미완료",
      value: todayAppointments.filter((item) => item.medication === "대기").length,
      tone: "red",
    },
    {
      label: "예약금 미처리",
      value: todayAppointments.filter((item) => item.deposit === "대기").length,
      tone: "green",
    },
    {
      label: "Follow-up 지연",
      value: pathologyCases.filter((item) => item.overdue && !item.completed).length,
      tone: "red",
    },
  ];

  return (
    <div className="metric-grid">
      {metrics.map((metric) => (
        <article className={`metric-card metric-card--${metric.tone}`} key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
          <small>명 / 건</small>
        </article>
      ))}
    </div>
  );
}

function TodayView({
  appointments,
  pathologyCases,
  onSelect,
}: {
  appointments: Appointment[];
  pathologyCases: PathologyCase[];
  onSelect: (id: string) => void;
}) {
  const todayAppointments = appointments.filter(
    (appointment) => appointment.date === "2026-07-30",
  );

  return (
    <section className="view-surface">
      <div className="view-title">
        <div>
          <span className="eyebrow">2026년 7월 30일 목요일</span>
          <h1>오늘 Dashboard</h1>
          <p>예약부터 검사 완료까지 필요한 업무만 우선순위로 확인합니다.</p>
        </div>
        <span className="data-chip">합성 데이터</span>
      </div>
      <DashboardMetrics appointments={appointments} pathologyCases={pathologyCases} />
      <div className="two-column-layout">
        <section className="content-card">
          <div className="content-card__heading">
            <h2>오늘 검사 순서</h2>
            <span>{todayAppointments.length}명</span>
          </div>
          <div className="compact-table" role="table">
            {todayAppointments.map((appointment) => (
              <button
                className="compact-row"
                key={appointment.id}
                onClick={() => onSelect(appointment.id)}
              >
                <strong>{appointment.start}</strong>
                <span>{appointment.name}</span>
                <small>{appointment.chartNumber}</small>
                <span>{formatAgeSex(appointment)}</span>
                <span className={`procedure-chip procedure-chip--${procedureTone(appointment.procedure)}`}>
                  {procedureLabel(appointment)}
                </span>
                <StateLabel state={appointment.verification} />
              </button>
            ))}
          </div>
        </section>
        <section className="content-card">
          <div className="content-card__heading">
            <h2>즉시 확인 필요</h2>
            <span>위험도 순</span>
          </div>
          <ul className="risk-list">
            <li>
              <Icon name="warning" />
              <div>
                <strong>이중확인 대기</strong>
                <span>검사 준비 전 이름·차트번호·생년월일·성별 재확인</span>
              </div>
              <b>3</b>
            </li>
            <li>
              <Icon name="medication" />
              <div>
                <strong>약제 의사 확인 필요</strong>
                <span>시스템은 약 중단 여부를 자동 결정하지 않습니다.</span>
              </div>
              <b>1</b>
            </li>
            <li>
              <Icon name="pathology" />
              <div>
                <strong>조직검체 Overdue</strong>
                <span>결과·통보·Follow-up 완료 상태 점검</span>
              </div>
              <b>{pathologyCases.filter((item) => item.overdue).length}</b>
            </li>
          </ul>
        </section>
      </div>
    </section>
  );
}

function MonthView({ appointments }: { appointments: Appointment[] }) {
  const days = Array.from({ length: 35 }, (_, index) => {
    const offset = index - 2;
    const date = new Date(2026, 6, 1 + offset);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(date.getDate()).padStart(2, "0")}`;
    return {
      iso,
      day: date.getDate(),
      currentMonth: date.getMonth() === 6,
      sunday: date.getDay() === 0,
    };
  });

  return (
    <section className="view-surface">
      <div className="view-title">
        <div>
          <span className="eyebrow">월간 Capacity</span>
          <h1>2026년 7월</h1>
          <p>날짜별 환자·검사 건수와 준비 미완료를 압축해 표시합니다.</p>
        </div>
      </div>
      <div className="month-grid">
        {["월", "화", "수", "목", "금", "토", "일"].map((day) => (
          <div className="month-grid__weekday" key={day}>
            {day}
          </div>
        ))}
        {days.map((day) => {
          const items = appointments.filter((item) => item.date === day.iso);
          const upper = items.filter(
            (item) => item.procedure === "위" || item.procedure === "위·대장",
          ).length;
          const colon = items.filter(
            (item) => item.procedure === "대장" || item.procedure === "위·대장",
          ).length;
          return (
            <article
              className={`month-cell ${!day.currentMonth ? "is-muted" : ""} ${
                day.sunday ? "is-closed" : ""
              }`}
              key={day.iso}
            >
              <span>{day.day}</span>
              {day.sunday ? (
                <small>휴진</small>
              ) : items.length > 0 ? (
                <>
                  <strong>{items.length}명</strong>
                  <small>
                    위 {upper} · 대장 {colon}
                  </small>
                  <div className="month-cell__badges">
                    {items.some((item) => item.afternoonException) && (
                      <em>14시 예외</em>
                    )}
                    {items.some((item) => item.verification === "대기") && (
                      <em className="is-warning">준비 미완료</em>
                    )}
                  </div>
                </>
              ) : (
                <small>예약 가능</small>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DayView({
  appointments,
  selectedId,
  onSelect,
}: {
  appointments: Appointment[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const todayAppointments = appointments.filter(
    (appointment) => appointment.date === "2026-07-30",
  );

  return (
    <section className="view-surface">
      <div className="view-title">
        <div>
          <span className="eyebrow">당일 검사 업무</span>
          <h1>7월 30일 일간</h1>
          <p>PACS 입력과 이중확인 상태를 검사 순서대로 봅니다.</p>
        </div>
      </div>
      <div className="day-workbench">
        <div className="day-timeline">
          {todayAppointments.map((appointment) => (
            <button
              className={`day-row ${selectedId === appointment.id ? "is-selected" : ""}`}
              key={appointment.id}
              onClick={() => onSelect(appointment.id)}
            >
              <time>{appointment.start}</time>
              <span className="day-row__line" />
              <span className="day-row__identity">
                <strong>{appointment.name}</strong>
                <small>{appointment.chartNumber}</small>
              </span>
              <span>{formatAgeSex(appointment)}</span>
              <span>{procedureLabel(appointment)}</span>
              <StateLabel state={appointment.verification} />
              <StateLabel state={appointment.pacs} />
            </button>
          ))}
        </div>
        <div className="pacs-panel">
          <span className="eyebrow">PACS 입력 확인 Panel</span>
          <h2>핵심정보 이중확인</h2>
          <p>선택 환자의 이름·차트번호·생년월일·성별·검사·수면을 확인합니다.</p>
          <div className="safety-banner">
            <Icon name="shield" />
            2차 확인 후 핵심정보가 수정되면 기존 확인은 자동 무효화됩니다.
          </div>
        </div>
      </div>
    </section>
  );
}

function ConfirmationView({
  appointments,
  onSelect,
}: {
  appointments: Appointment[];
  onSelect: (id: string) => void;
}) {
  const queue = appointments.filter(
    (appointment) =>
      appointment.d1 === "대기" ||
      appointment.medication === "대기" ||
      appointment.verification === "대기",
  );

  return (
    <section className="view-surface">
      <div className="view-title">
        <div>
          <span className="eyebrow">D-1 · 약제 · 이중확인</span>
          <h1>확인 업무 Queue</h1>
          <p>미완료 항목과 재연락 예정자를 한 Queue에서 처리합니다.</p>
        </div>
      </div>
      <div className="table-card">
        <div className="data-table data-table--confirmation">
          <div className="data-table__head">
            <span>일시</span>
            <span>환자</span>
            <span>나이 · 성별</span>
            <span>검사</span>
            <span>D-1</span>
            <span>약제</span>
            <span>이중확인</span>
            <span>작업</span>
          </div>
          {queue.map((appointment) => (
            <button
              className="data-table__row"
              key={appointment.id}
              onClick={() => onSelect(appointment.id)}
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
              <StateLabel state={appointment.d1} />
              <StateLabel state={appointment.medication} />
              <StateLabel state={appointment.verification} />
              <span className="row-action">확인 열기</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function pathologyStatus(pathologyCase: PathologyCase) {
  if (pathologyCase.completed) return "완료";
  if (pathologyCase.overdue) return "Overdue";
  if (!pathologyCase.resultReportDate) return "결과 대기";
  if (!pathologyCase.doctorChecked) return "의사 확인 대기";
  if (!pathologyCase.patientNotified) return "환자 통보 대기";
  if (pathologyCase.followUpNeeded) return "Follow-up 예정";
  return "완료 처리 대기";
}

function PathologyLedger({
  cases,
  onSelect,
}: {
  cases: PathologyCase[];
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState("전체");
  const statuses = [
    "전체",
    "결과 대기",
    "의사 확인 대기",
    "환자 통보 대기",
    "Follow-up 예정",
    "Overdue",
    "완료",
  ];
  const visibleCases =
    filter === "전체"
      ? cases
      : cases.filter((pathologyCase) => pathologyStatus(pathologyCase) === filter);

  return (
    <section className="view-surface">
      <div className="view-title">
        <div>
          <span className="eyebrow">Biopsy · CLO</span>
          <h1>조직검체 관리대장</h1>
          <p>
            결과보고일은 최초 게시일만 기록하며, 기관+접수번호로 중복을
            방지합니다.
          </p>
        </div>
        <span className="data-chip">과거 Excel 조회용 보관</span>
      </div>
      <div className="filter-tabs" role="tablist" aria-label="조직검체 상태 필터">
        {statuses.map((status) => {
          const count = cases.filter(
            (pathologyCase) => pathologyStatus(pathologyCase) === status,
          ).length;
          return (
            <button
              role="tab"
              aria-selected={filter === status}
              className={filter === status ? "is-active" : ""}
              onClick={() => setFilter(status)}
              key={status}
            >
              {status}
              {status !== "전체" && <span>{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="table-card">
        <div className="data-table data-table--pathology">
          <div className="data-table__head">
            <span>상태</span>
            <span>환자</span>
            <span>검사일 / 종류</span>
            <span>채취 부위</span>
            <span>기관 · 접수번호</span>
            <span>결과보고일</span>
            <span>환자 통보</span>
            <span>Follow-up</span>
          </div>
          {visibleCases.map((pathologyCase) => (
            <button
              className="data-table__row"
              key={pathologyCase.id}
              onClick={() => onSelect(pathologyCase.id)}
            >
              <span>
                <span
                  className={`pathology-status pathology-status--${pathologyStatus(
                    pathologyCase,
                  )
                    .replaceAll(" ", "-")
                    .toLowerCase()}`}
                >
                  {pathologyStatus(pathologyCase)}
                </span>
              </span>
              <span>
                <strong>{pathologyCase.patientName}</strong>
                <small>
                  {pathologyCase.chartNumber} ·{" "}
                  {calculateAge(
                    pathologyCase.dateOfBirth,
                    pathologyCase.examinationDate,
                    "일반",
                  )}{" "}
                  · {pathologyCase.sex}
                </small>
              </span>
              <span>
                {pathologyCase.examinationDate}
                <small>
                  {pathologyCase.caseType} · {pathologyCase.procedure}
                </small>
              </span>
              <span>{pathologyCase.site}</span>
              <span>
                {pathologyCase.laboratory}
                <small>{pathologyCase.accessionNumber}</small>
              </span>
              <span>{pathologyCase.resultReportDate ?? "미도착"}</span>
              <span>{pathologyCase.patientNotified ? "완료" : "대기"}</span>
              <span>{pathologyCase.followUpDate ?? "해당 없음"}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function PatientHistoryView({ appointments }: { appointments: Appointment[] }) {
  const patients = Array.from(
    new Map(appointments.map((appointment) => [appointment.chartNumber, appointment])).values(),
  );
  return (
    <section className="view-surface">
      <div className="view-title">
        <div>
          <span className="eyebrow">환자 검색 · 과거 예약</span>
          <h1>환자 History</h1>
          <p>이름만으로 판단하지 않고 차트번호·생년월일·성별을 함께 확인합니다.</p>
        </div>
      </div>
      <div className="table-card">
        <div className="data-table data-table--patients">
          <div className="data-table__head">
            <span>환자</span>
            <span>차트번호</span>
            <span>생년월일</span>
            <span>나이 · 성별</span>
            <span>최근 검사</span>
            <span>취소</span>
            <span>No-show</span>
          </div>
          {patients.slice(0, 12).map((patient, index) => (
            <div className="data-table__row" key={patient.chartNumber}>
              <span>
                <strong>{patient.name}</strong>
              </span>
              <span>{patient.chartNumber}</span>
              <span>{patient.dateOfBirth}</span>
              <span>{formatAgeSex(patient)}</span>
              <span>
                {patient.date} · {patient.procedure}
              </span>
              <span>{index % 4 === 0 ? 1 : 0}회</span>
              <span>{index % 7 === 0 ? 1 : 0}회</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatisticsView({ appointments }: { appointments: Appointment[] }) {
  const standard = appointments.filter((item) => !item.afternoonException);
  const exception = appointments.filter((item) => item.afternoonException);
  const count = (items: Appointment[], procedure: "upper" | "colon") =>
    items.filter((item) =>
      procedure === "upper"
        ? item.procedure === "위" || item.procedure === "위·대장"
        : item.procedure === "대장" || item.procedure === "위·대장",
    ).length;
  return (
    <section className="view-surface">
      <div className="view-title">
        <div>
          <span className="eyebrow">환자 수와 검사 건수 분리</span>
          <h1>주간 운영 통계</h1>
          <p>일반 오전과 오후 예외 Capacity Bucket을 섞지 않습니다.</p>
        </div>
      </div>
      <div className="statistics-grid">
        <article className="content-card">
          <span className="eyebrow">STANDARD_MORNING</span>
          <h2>일반 예약</h2>
          <dl className="stat-definition">
            <div>
              <dt>환자</dt>
              <dd>{standard.length}</dd>
            </div>
            <div>
              <dt>위내시경</dt>
              <dd>{count(standard, "upper")}</dd>
            </div>
            <div>
              <dt>대장내시경</dt>
              <dd>{count(standard, "colon")}</dd>
            </div>
          </dl>
        </article>
        <article className="content-card content-card--exception">
          <span className="eyebrow">AFTERNOON_EXCEPTION</span>
          <h2>오후 예외 예약</h2>
          <dl className="stat-definition">
            <div>
              <dt>환자</dt>
              <dd>{exception.length}</dd>
            </div>
            <div>
              <dt>위내시경</dt>
              <dd>{count(exception, "upper")}</dd>
            </div>
            <div>
              <dt>대장내시경</dt>
              <dd>{count(exception, "colon")}</dd>
            </div>
          </dl>
        </article>
        <article className="content-card">
          <span className="eyebrow">TOTAL ACTUAL</span>
          <h2>전체 실제 검사 건수</h2>
          <dl className="stat-definition">
            <div>
              <dt>환자</dt>
              <dd>{appointments.length}</dd>
            </div>
            <div>
              <dt>위내시경</dt>
              <dd>{count(appointments, "upper")}</dd>
            </div>
            <div>
              <dt>대장내시경</dt>
              <dd>{count(appointments, "colon")}</dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  );
}

function AdminView() {
  const settings = [
    {
      title: "요일별 운영시간",
      description: "월·화·목·금 09:00~12:00 / 수·토 09:00~11:00",
      value: "적용 중",
    },
    {
      title: "검사 소요시간",
      description: "위 30분 / 대장 60분 / 위·대장 60분",
      value: "적용 중",
    },
    {
      title: "일일 일반 수용량",
      description: "위 5건 / 대장 3건 · 수·토는 점유시간 기준",
      value: "적용 중",
    },
    {
      title: "오후 예외",
      description: "14:00 · 하루 1명 · 사유와 관리자 확인 필수",
      value: "허용",
    },
    {
      title: "날짜별 예외",
      description: "2026-07-29 10:30~11:00 장비 점검 차단",
      value: "승인됨",
    },
    {
      title: "예약금",
      description: "기본 예약금 20,000원",
      value: "변경 가능",
    },
  ];
  return (
    <section className="view-surface">
      <div className="view-title">
        <div>
          <span className="eyebrow">승인 · Audit Log</span>
          <h1>관리자 설정</h1>
          <p>업무 규칙은 Source Code가 아닌 승인 가능한 설정으로 관리합니다.</p>
        </div>
      </div>
      <div className="settings-list">
        {settings.map((setting) => (
          <button className="setting-row" key={setting.title}>
            <span className="setting-row__icon">
              <Icon name="admin" />
            </span>
            <span>
              <strong>{setting.title}</strong>
              <small>{setting.description}</small>
            </span>
            <em>{setting.value}</em>
            <Icon name="chevron" />
          </button>
        ))}
      </div>
      <div className="admin-note">
        <Icon name="info" />
        <p>
          현재 운영은 원장 1명·내시경실 1개이므로 의사·실 선택 항목을 표시하지
          않습니다. 일정은 하나의 공용 일정으로 관리합니다.
        </p>
      </div>
    </section>
  );
}

function draftFromAppointment(appointment?: Appointment): BookingDraft {
  if (appointment) {
    return {
      id: appointment.id,
      name: appointment.name,
      chartNumber: appointment.chartNumber,
      dateOfBirth: appointment.dateOfBirth,
      sex: appointment.sex,
      careCategory: appointment.careCategory,
      procedure: appointment.procedure,
      upperSedation: appointment.upperSedation ?? false,
      colonSedation: appointment.colonSedation ?? false,
      date: appointment.date,
      start: appointment.start,
      bucket: appointment.afternoonException
        ? "AFTERNOON_EXCEPTION"
        : "STANDARD_MORNING",
      screeningCopay: appointment.screeningCopay ?? "없음",
      bowelPreparation: appointment.bowelPreparation ?? "원프렙",
      medicationsChecked: appointment.medication === "완료",
      additionalExaminations: [],
      depositPaid: appointment.deposit === "완료",
      exceptionReason: appointment.exceptionReason ?? "",
      exceptionConfirmedBy: appointment.exceptionConfirmedBy ?? "",
      exceptionMemo: appointment.memo ?? "",
    };
  }

  return {
    name: "서가윤",
    chartNumber: "T-260801-101",
    dateOfBirth: "1982-09-14",
    sex: "여",
    careCategory: "검진",
    procedure: "위·대장",
    upperSedation: true,
    colonSedation: false,
    date: "2026-08-01",
    start: "10:30",
    bucket: "STANDARD_MORNING",
    screeningCopay: "없음",
    bowelPreparation: "원프렙",
    medicationsChecked: false,
    additionalExaminations: [],
    depositPaid: true,
    exceptionReason: "",
    exceptionConfirmedBy: "",
    exceptionMemo: "",
  };
}

function BookingWizard({
  appointment,
  appointments,
  onClose,
  onSave,
}: {
  appointment?: Appointment;
  appointments: Appointment[];
  onClose: () => void;
  onSave: (draft: BookingDraft, validation: ValidationResult) => void;
}) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<BookingDraft>(() =>
    draftFromAppointment(appointment),
  );
  const [saveAttempted, setSaveAttempted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const validation = useMemo(
    () => validateBooking(draft, appointments, appointment?.id),
    [draft, appointments, appointment?.id],
  );
  const age = calculateAge(draft.dateOfBirth, draft.date, draft.careCategory);

  const patchDraft = <Key extends keyof BookingDraft>(
    key: Key,
    value: BookingDraft[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const firstFocusable = dialog.querySelector<HTMLElement>(
      "button, input, select, textarea",
    );
    firstFocusable?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const slotStarts =
    draft.bucket === "AFTERNOON_EXCEPTION"
      ? ["14:00"]
      : standardStartsFor(draft.date);

  const renderStep = () => {
    if (step === 1) {
      return (
        <div className="form-section">
          <div className="form-section__heading">
            <span className="step-number">1</span>
            <div>
              <h3>환자 확인</h3>
              <p>이름 외에 차트번호·생년월일·성별을 함께 확인합니다.</p>
            </div>
          </div>
          <div className="form-grid form-grid--two">
            <label className="field">
              <span>이름</span>
              <input
                value={draft.name}
                onChange={(event) => patchDraft("name", event.target.value)}
              />
            </label>
            <label className="field">
              <span>차트번호</span>
              <input
                value={draft.chartNumber}
                onChange={(event) => patchDraft("chartNumber", event.target.value)}
              />
            </label>
            <label className="field">
              <span>생년월일</span>
              <input
                type="date"
                value={draft.dateOfBirth}
                onChange={(event) => patchDraft("dateOfBirth", event.target.value)}
              />
            </label>
            <fieldset className="field">
              <legend>성별</legend>
              <div className="segmented-control">
                {(["여", "남"] as const).map((sex) => (
                  <button
                    type="button"
                    className={draft.sex === sex ? "is-active" : ""}
                    onClick={() => patchDraft("sex", sex)}
                    key={sex}
                  >
                    {sex}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="identity-confirmation">
            <Icon name="shield" />
            <div>
              <strong>
                {draft.name} · {draft.chartNumber}
              </strong>
              <span>
                {draft.dateOfBirth} ·{" "}
                {draft.careCategory === "검진" ? age : `만 ${age}`} · {draft.sex}
              </span>
            </div>
            <span className="state-label state-label--success">
              <Icon name="check" />
              1차 확인
            </span>
          </div>
        </div>
      );
    }

    if (step === 2) {
      return (
        <div className="form-section">
          <div className="form-section__heading">
            <span className="step-number">2</span>
            <div>
              <h3>검사 종류와 일정</h3>
              <p>선택한 시간은 저장 직전에 Backend에서도 다시 검증됩니다.</p>
            </div>
          </div>
          <label className="field">
            <span>검사 종류</span>
            <div className="choice-cards choice-cards--three">
              {(["위", "대장", "위·대장"] as const).map((procedure) => (
                <button
                  type="button"
                  className={draft.procedure === procedure ? "is-active" : ""}
                  onClick={() => patchDraft("procedure", procedure)}
                  key={procedure}
                >
                  <strong>{procedure}</strong>
                  <small>{procedureDuration(procedure)}분 점유</small>
                </button>
              ))}
            </div>
          </label>
          <div className="form-grid form-grid--two">
            {(draft.procedure === "위" || draft.procedure === "위·대장") && (
              <fieldset className="field">
                <legend>위내시경 수면 여부</legend>
                <div className="segmented-control">
                  <button
                    type="button"
                    className={draft.upperSedation ? "is-active" : ""}
                    onClick={() => patchDraft("upperSedation", true)}
                  >
                    수면
                  </button>
                  <button
                    type="button"
                    className={!draft.upperSedation ? "is-active" : ""}
                    onClick={() => patchDraft("upperSedation", false)}
                  >
                    비수면
                  </button>
                </div>
              </fieldset>
            )}
            {(draft.procedure === "대장" || draft.procedure === "위·대장") && (
              <fieldset className="field">
                <legend>대장내시경 수면 여부</legend>
                <div className="segmented-control">
                  <button
                    type="button"
                    className={draft.colonSedation ? "is-active" : ""}
                    onClick={() => patchDraft("colonSedation", true)}
                  >
                    수면
                  </button>
                  <button
                    type="button"
                    className={!draft.colonSedation ? "is-active" : ""}
                    onClick={() => patchDraft("colonSedation", false)}
                  >
                    비수면
                  </button>
                </div>
              </fieldset>
            )}
          </div>
          <div className="form-grid form-grid--two">
            <label className="field">
              <span>검사 예정일</span>
              <input
                type="date"
                value={draft.date}
                min="2026-07-27"
                max="2026-08-31"
                onChange={(event) => patchDraft("date", event.target.value)}
              />
            </label>
            <fieldset className="field">
              <legend>예약 구분</legend>
              <div className="segmented-control">
                <button
                  type="button"
                  className={
                    draft.bucket === "STANDARD_MORNING" ? "is-active" : ""
                  }
                  onClick={() => {
                    patchDraft("bucket", "STANDARD_MORNING");
                    patchDraft("start", "09:00");
                  }}
                >
                  일반 오전
                </button>
                <button
                  type="button"
                  className={
                    draft.bucket === "AFTERNOON_EXCEPTION" ? "is-active" : ""
                  }
                  onClick={() => {
                    patchDraft("bucket", "AFTERNOON_EXCEPTION");
                    patchDraft("start", "14:00");
                  }}
                >
                  14시 예외
                </button>
              </div>
            </fieldset>
          </div>
          <fieldset className="field">
            <legend>예약 시간</legend>
            <div className="slot-picker">
              {slotStarts.map((start) => {
                const slotValidation = validateBooking(
                  { ...draft, start },
                  appointments,
                  appointment?.id,
                  false,
                );
                return (
                  <button
                    type="button"
                    className={`${draft.start === start ? "is-selected" : ""} ${
                      slotValidation.valid ? "is-available" : "is-unavailable"
                    }`}
                    onClick={() => patchDraft("start", start)}
                    key={start}
                    title={
                      slotValidation.valid
                        ? "예약 가능"
                        : slotValidation.errors.join(" ")
                    }
                  >
                    <strong>{start}</strong>
                    <small>{slotValidation.valid ? "가능" : "확인 필요"}</small>
                  </button>
                );
              })}
            </div>
          </fieldset>
          {draft.bucket === "AFTERNOON_EXCEPTION" && (
            <div className="exception-form">
              <div className="exception-form__title">
                <Icon name="warning" />
                <div>
                  <strong>오후 예외 예약 필수 기록</strong>
                  <span>오전 수용량과 별도로 하루 1명만 허용됩니다.</span>
                </div>
              </div>
              <div className="form-grid form-grid--two">
                <label className="field">
                  <span>예외 사유</span>
                  <input
                    value={draft.exceptionReason}
                    onChange={(event) =>
                      patchDraft("exceptionReason", event.target.value)
                    }
                    placeholder="예: 원장 승인 예외"
                  />
                </label>
                <label className="field">
                  <span>확인자</span>
                  <input
                    value={draft.exceptionConfirmedBy}
                    onChange={(event) =>
                      patchDraft("exceptionConfirmedBy", event.target.value)
                    }
                    placeholder="관리자"
                  />
                </label>
              </div>
              <label className="field">
                <span>관련 메모</span>
                <textarea
                  rows={2}
                  value={draft.exceptionMemo}
                  onChange={(event) =>
                    patchDraft("exceptionMemo", event.target.value)
                  }
                />
              </label>
            </div>
          )}
        </div>
      );
    }

    if (step === 3) {
      return (
        <div className="form-section">
          <div className="form-section__heading">
            <span className="step-number">3</span>
            <div>
              <h3>검진 정보</h3>
              <p>검진과 일반은 나이 계산 방법이 다릅니다.</p>
            </div>
          </div>
          <fieldset className="field">
            <legend>일반 / 검진</legend>
            <div className="choice-cards choice-cards--two">
              {(["검진", "일반"] as const).map((category) => (
                <button
                  type="button"
                  className={draft.careCategory === category ? "is-active" : ""}
                  onClick={() => patchDraft("careCategory", category)}
                  key={category}
                >
                  <strong>{category}</strong>
                  <small>
                    {category === "검진"
                      ? "검사연도 − 출생연도"
                      : "검사일 기준 만 나이"}
                  </small>
                </button>
              ))}
            </div>
          </fieldset>
          {draft.careCategory === "검진" && (
            <fieldset className="field">
              <legend>검진 본인부담</legend>
              <div className="segmented-control">
                {(["없음", "10%"] as const).map((copay) => (
                  <button
                    type="button"
                    className={draft.screeningCopay === copay ? "is-active" : ""}
                    onClick={() => patchDraft("screeningCopay", copay)}
                    key={copay}
                  >
                    {copay}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <div className="age-policy-card">
            <span>{draft.careCategory} 나이 표시</span>
            <strong>
              {draft.careCategory === "검진" ? age : `만 ${age}`} · {draft.sex}
            </strong>
            <small>
              나이는 저장하지 않고 생년월일과 검사 예정일로 매번 계산합니다.
            </small>
          </div>
        </div>
      );
    }

    if (step === 4) {
      const includesColon =
        draft.procedure === "대장" || draft.procedure === "위·대장";
      return (
        <div className="form-section">
          <div className="form-section__heading">
            <span className="step-number">4</span>
            <div>
              <h3>장정결제</h3>
              <p>대장내시경이 포함된 경우 수령과 복용법 안내를 확인합니다.</p>
            </div>
          </div>
          {includesColon ? (
            <>
              <label className="field">
                <span>장정결제 종류</span>
                <select
                  value={draft.bowelPreparation}
                  onChange={(event) =>
                    patchDraft("bowelPreparation", event.target.value)
                  }
                >
                  <option>원프렙</option>
                  <option>수클리어산</option>
                  <option>수프렙미니에스정</option>
                  <option>기타</option>
                </select>
              </label>
              <div className="check-card-grid">
                <CheckCard label="장정결제 수령" checked />
                <CheckCard label="복용법 안내" checked />
                <CheckCard label="장정결 불량 재검" checked={false} />
              </div>
            </>
          ) : (
            <EmptyState
              title="대장내시경이 포함되지 않았습니다."
              description="이 단계는 해당 없음으로 처리됩니다."
            />
          )}
        </div>
      );
    }

    if (step === 5) {
      return (
        <div className="form-section">
          <div className="form-section__heading">
            <span className="step-number">5</span>
            <div>
              <h3>복용약 · 수술이력</h3>
              <p>약제 중단 여부는 담당 의사의 확인이 필요합니다.</p>
            </div>
          </div>
          <div className="medication-warning">
            <Icon name="warning" />
            <div>
              <strong>약제 중단 여부는 담당 의사의 확인이 필요합니다.</strong>
              <span>시스템이 자동으로 중단 여부나 기간을 결정하지 않습니다.</span>
            </div>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.medicationsChecked}
              onChange={(event) =>
                patchDraft("medicationsChecked", event.target.checked)
              }
            />
            <span>
              <strong>전체 복용약 목록 확인 완료</strong>
              <small>합성 Prototype에서는 약명 상세를 저장하지 않습니다.</small>
            </span>
          </label>
          <div className="check-card-grid check-card-grid--four">
            <CheckCard label="항응고제" checked={false} />
            <CheckCard label="항혈소판제" checked />
            <CheckCard label="심장·혈관 시술력" checked={false} />
            <CheckCard label="의사 확인" checked={false} warning />
          </div>
        </div>
      );
    }

    if (step === 6) {
      const options = ["피검사", "CLO", "복부초음파", "갑상선초음파"];
      return (
        <div className="form-section">
          <div className="form-section__heading">
            <span className="step-number">6</span>
            <div>
              <h3>추가 검사</h3>
              <p>동일 내원일에 함께 안내할 추가 검사를 선택합니다.</p>
            </div>
          </div>
          <div className="choice-cards choice-cards--two">
            {options.map((option) => {
              const selected = draft.additionalExaminations.includes(option);
              return (
                <button
                  type="button"
                  className={selected ? "is-active" : ""}
                  onClick={() =>
                    patchDraft(
                      "additionalExaminations",
                      selected
                        ? draft.additionalExaminations.filter(
                            (item) => item !== option,
                          )
                        : [...draft.additionalExaminations, option],
                    )
                  }
                  key={option}
                >
                  <strong>{option}</strong>
                  <small>{selected ? "선택됨" : "선택 안 함"}</small>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (step === 7) {
      return (
        <div className="form-section">
          <div className="form-section__heading">
            <span className="step-number">7</span>
            <div>
              <h3>예약금</h3>
              <p>기본 금액과 환불 규정 고지 여부를 확인합니다.</p>
            </div>
          </div>
          <div className="deposit-card">
            <div>
              <span>기본 예약금</span>
              <strong>20,000원</strong>
            </div>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={draft.depositPaid}
                onChange={(event) =>
                  patchDraft("depositPaid", event.target.checked)
                }
              />
              <span>납부 완료</span>
            </label>
          </div>
          <div className="check-card-grid">
            <CheckCard label="취소·환불 규정 고지" checked />
            <CheckCard label="환자 동의" checked />
            <CheckCard label="납부일 기록" checked={draft.depositPaid} />
          </div>
        </div>
      );
    }

    return (
      <div className="form-section">
        <div className="form-section__heading">
          <span className="step-number">8</span>
          <div>
            <h3>최종 확인</h3>
            <p>예약 저장 전 환자와 일정, 필수 준비 상태를 다시 확인합니다.</p>
          </div>
        </div>
        <div className="final-summary">
          <div>
            <span>환자</span>
            <strong>
              {draft.name} · {draft.chartNumber}
            </strong>
            <small>
              {draft.careCategory === "검진" ? age : `만 ${age}`} · {draft.sex}
            </small>
          </div>
          <div>
            <span>일정</span>
            <strong>
              {draft.date} {draft.start}–{validation.end}
            </strong>
            <small>
              {draft.bucket === "AFTERNOON_EXCEPTION"
                ? "오후 예외 예약"
                : "일반 오전 예약"}
            </small>
          </div>
          <div>
            <span>검사</span>
            <strong>{draft.procedure}</strong>
            <small>{validation.duration}분 점유</small>
          </div>
          <div>
            <span>준비</span>
            <strong>
              약제 {draft.medicationsChecked ? "확인" : "미완료"} · 예약금{" "}
              {draft.depositPaid ? "완료" : "대기"}
            </strong>
            <small>2차 확인은 당일 별도 수행</small>
          </div>
        </div>
        <div
          className={`save-readiness ${
            validation.valid ? "is-valid" : "is-invalid"
          }`}
        >
          <Icon name={validation.valid ? "check" : "warning"} />
          <div>
            <strong>
              {validation.valid ? "예약 저장 가능" : "예약 저장 전 확인 필요"}
            </strong>
            <span>
              {validation.valid
                ? "현재 합성 일정 Snapshot 기준으로 충돌이 없습니다."
                : validation.errors[0]}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="booking-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-modal-title"
        ref={dialogRef}
      >
        <header className="booking-modal__header">
          <div>
            <span className="eyebrow">
              {appointment ? "예약 변경" : "신규 예약"}
            </span>
            <h2 id="booking-modal-title">
              {appointment ? `${appointment.name} 예약 변경` : "예약 등록"}
            </h2>
          </div>
          <span className="data-chip">합성 데이터</span>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </header>

        <div className="booking-modal__body">
          <nav className="wizard-nav" aria-label="예약 등록 단계">
            {WIZARD_STEPS.map((label, index) => {
              const stepNumber = index + 1;
              return (
                <button
                  className={`${step === stepNumber ? "is-active" : ""} ${
                    stepNumber < step ? "is-complete" : ""
                  }`}
                  onClick={() => setStep(stepNumber)}
                  key={label}
                >
                  <span>{stepNumber < step ? <Icon name="check" /> : stepNumber}</span>
                  <strong>{label}</strong>
                </button>
              );
            })}
          </nav>

          <main className="wizard-content">{renderStep()}</main>

          <aside className="validation-panel" aria-live="polite">
            <span className="eyebrow">Scheduling 검증</span>
            <div
              className={`validation-panel__result ${
                validation.valid ? "is-valid" : "is-invalid"
              }`}
            >
              <Icon name={validation.valid ? "check" : "warning"} />
              <div>
                <strong>
                  {validation.valid ? "선택 시간 예약 가능" : "예약 불가"}
                </strong>
                <span>
                  {draft.start}–{validation.end} · {validation.duration}분
                </span>
              </div>
            </div>
            {validation.errors.length > 0 && (
              <ul className="validation-errors">
                {validation.errors.map((error) => (
                  <li key={error}>
                    <Icon name="warning" />
                    <span>{error}</span>
                  </li>
                ))}
              </ul>
            )}
            {validation.alternatives.length > 0 && (
              <div className="alternatives">
                <span>가능한 대체시간</span>
                <div>
                  {validation.alternatives.map((alternative) => (
                    <button
                      type="button"
                      onClick={() => patchDraft("start", alternative)}
                      key={alternative}
                    >
                      {alternative}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <dl className="rule-summary">
              <div>
                <dt>운영시간</dt>
                <dd>
                  {isShortMorning(draft.date) ? "09:00~11:00" : "09:00~12:00"}
                </dd>
              </div>
              <div>
                <dt>점유</dt>
                <dd>{validation.duration}분</dd>
              </div>
              <div>
                <dt>Capacity</dt>
                <dd>
                  {draft.bucket === "AFTERNOON_EXCEPTION"
                    ? "오후 별도 1명"
                    : isShortMorning(draft.date)
                      ? "4 Slot 기반"
                      : "위 5 · 대장 3"}
                </dd>
              </div>
            </dl>
            {saveAttempted && !validation.valid && (
              <div className="save-error" role="alert">
                오류를 해결하기 전에는 원래 예약을 변경하지 않습니다.
              </div>
            )}
          </aside>
        </div>

        <footer className="booking-modal__footer">
          <button className="secondary-button" onClick={onClose}>
            취소
          </button>
          <div>
            <button
              className="secondary-button"
              disabled={step === 1}
              onClick={() => setStep((current) => Math.max(1, current - 1))}
            >
              이전
            </button>
            {step < 8 ? (
              <button
                className="primary-button"
                onClick={() => setStep((current) => Math.min(8, current + 1))}
              >
                다음
              </button>
            ) : (
              <button
                className="primary-button"
                onClick={() => {
                  setSaveAttempted(true);
                  if (validation.valid) onSave(draft, validation);
                }}
              >
                <Icon name="check" />
                {appointment ? "변경 저장" : "예약 저장"}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function CheckCard({
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

function EmptyState({
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

function AppointmentDrawer({
  appointment,
  onClose,
  onEdit,
}: {
  appointment: Appointment;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [tab, setTab] = useState("기본정보");
  const tabs = [
    "기본정보",
    "준비상태",
    "약제확인",
    "예약금",
    "변경이력",
    "검사결과",
    "조직검사",
  ];

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="예약 상세"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="detail-drawer__header">
          <div>
            <span className="eyebrow">예약 상세</span>
            <h2>{appointment.name}</h2>
            <p>
              {appointment.chartNumber} · {formatAgeSex(appointment)}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </header>
        <nav className="drawer-tabs">
          {tabs.map((item) => (
            <button
              className={tab === item ? "is-active" : ""}
              onClick={() => setTab(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </nav>
        <div className="detail-drawer__content">
          <div className="drawer-section">
            <span className="eyebrow">{tab}</span>
            <h3>
              {tab === "기본정보" ? "환자 및 검사 정보" : `${tab} 기록`}
            </h3>
            <dl className="drawer-definition">
              <div>
                <dt>검사 예정</dt>
                <dd>
                  {appointment.date} {appointment.start}
                </dd>
              </div>
              <div>
                <dt>검사 종류</dt>
                <dd>{procedureLabel(appointment)}</dd>
              </div>
              <div>
                <dt>생년월일</dt>
                <dd>{appointment.dateOfBirth}</dd>
              </div>
              <div>
                <dt>나이 · 성별</dt>
                <dd>{formatAgeSex(appointment)}</dd>
              </div>
              <div>
                <dt>장정결제</dt>
                <dd>{appointment.bowelPreparation ?? "해당 없음"}</dd>
              </div>
              <div>
                <dt>PACS 확인</dt>
                <dd>
                  <StateLabel state={appointment.pacs} />
                </dd>
              </div>
            </dl>
          </div>
          <div className="audit-callout">
            <Icon name="history" />
            <div>
              <strong>변경 이력은 삭제되지 않습니다.</strong>
              <span>
                핵심정보 변경 시 기존 이중확인 상태는 무효화되고 재확인이
                필요합니다.
              </span>
            </div>
          </div>
        </div>
        <footer className="detail-drawer__footer">
          <button className="secondary-button" onClick={onClose}>
            닫기
          </button>
          <button className="primary-button" onClick={onEdit}>
            <Icon name="edit" />
            예약 변경
          </button>
        </footer>
      </aside>
    </div>
  );
}

function PathologyDrawer({
  pathologyCase,
  onClose,
  onUpdate,
}: {
  pathologyCase: PathologyCase;
  onClose: () => void;
  onUpdate: (patch: Partial<PathologyCase>) => void;
}) {
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="조직검체 Case 상세"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="detail-drawer__header">
          <div>
            <span className="eyebrow">{pathologyCase.caseType} Case</span>
            <h2>{pathologyCase.patientName}</h2>
            <p>
              {pathologyCase.chartNumber} ·{" "}
              {calculateAge(
                pathologyCase.dateOfBirth,
                pathologyCase.examinationDate,
                "일반",
              )}{" "}
              · {pathologyCase.sex}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </header>
        <div className="detail-drawer__content">
          <span className="pathology-status">
            {pathologyStatus(pathologyCase)}
          </span>
          <dl className="drawer-definition">
            <div>
              <dt>검사일</dt>
              <dd>{pathologyCase.examinationDate}</dd>
            </div>
            <div>
              <dt>채취 부위</dt>
              <dd>{pathologyCase.site}</dd>
            </div>
            <div>
              <dt>기관</dt>
              <dd>{pathologyCase.laboratory}</dd>
            </div>
            <div>
              <dt>접수번호</dt>
              <dd>{pathologyCase.accessionNumber}</dd>
            </div>
            <div>
              <dt>결과보고일</dt>
              <dd>{pathologyCase.resultReportDate ?? "결과 대기"}</dd>
            </div>
            <div>
              <dt>관리자 기록</dt>
              <dd>{pathologyCase.owner}</dd>
            </div>
          </dl>
          <div className="policy-callout">
            <Icon name="info" />
            <span>
              결과보고일은 씨젠 사이트에 최초 게시된 일자입니다. 원내 도착일은
              별도로 관리하지 않습니다.
            </span>
          </div>
          {pathologyCase.resultSummary && (
            <div className="result-summary">
              <span>결과 요약</span>
              <p>{pathologyCase.resultSummary}</p>
            </div>
          )}
          <div className="case-actions">
            <button
              className={pathologyCase.doctorChecked ? "is-complete" : ""}
              onClick={() => onUpdate({ doctorChecked: true })}
            >
              <Icon name="check" />
              의사 확인 {pathologyCase.doctorChecked ? "완료" : "기록"}
            </button>
            <button
              className={pathologyCase.patientNotified ? "is-complete" : ""}
              onClick={() =>
                onUpdate({
                  patientNotified: true,
                  notificationDate: "2026-07-30",
                  notificationMethod: "전화",
                })
              }
            >
              <Icon name="phone" />
              환자 통보 {pathologyCase.patientNotified ? "완료" : "기록"}
            </button>
            <button
              className={pathologyCase.completed ? "is-complete" : ""}
              onClick={() => onUpdate({ completed: true, overdue: false })}
            >
              <Icon name="check" />
              Follow-up 완료
            </button>
          </div>
        </div>
        <footer className="detail-drawer__footer">
          <button className="secondary-button" onClick={onClose}>
            닫기
          </button>
        </footer>
      </aside>
    </div>
  );
}

export function App() {
  const [loggedIn, setLoggedIn] = useState(true);
  const [activeView, setActiveView] = useState<ViewId>("week");
  const [appointments, setAppointments] =
    useState<Appointment[]>(initialAppointments);
  const [pathologyCases, setPathologyCases] =
    useState<PathologyCase[]>(initialPathologyCases);
  const [selectedId, setSelectedId] = useState("APT-017");
  const [bookingModal, setBookingModal] = useState<{
    mode: "new" | "edit";
    appointmentId?: string;
  } | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedAppointment = appointments.find(
    (appointment) => appointment.id === selectedId,
  );
  const editingAppointment =
    bookingModal?.mode === "edit"
      ? appointments.find(
          (appointment) => appointment.id === bookingModal.appointmentId,
        )
      : undefined;

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const openNewBooking = () => {
    setDrawer(null);
    setBookingModal({ mode: "new" });
  };

  const openEditBooking = (appointmentId = selectedId) => {
    if (!appointmentId) return;
    setDrawer(null);
    setBookingModal({ mode: "edit", appointmentId });
  };

  const verifySelected = () => {
    if (!selectedAppointment) return;
    setAppointments((current) =>
      current.map((appointment) =>
        appointment.id === selectedAppointment.id
          ? { ...appointment, verification: "완료" as const }
          : appointment,
      ),
    );
    notify(`${selectedAppointment.name}님의 2차 확인을 기록했습니다.`);
  };

  const saveBooking = (draft: BookingDraft, validation: ValidationResult) => {
    if (bookingModal?.mode === "edit" && editingAppointment) {
      const coreChanged =
        editingAppointment.date !== draft.date ||
        editingAppointment.start !== draft.start ||
        editingAppointment.procedure !== draft.procedure ||
        editingAppointment.name !== draft.name ||
        editingAppointment.chartNumber !== draft.chartNumber ||
        editingAppointment.dateOfBirth !== draft.dateOfBirth ||
        editingAppointment.sex !== draft.sex ||
        editingAppointment.upperSedation !== draft.upperSedation ||
        editingAppointment.colonSedation !== draft.colonSedation;
      setAppointments((current) =>
        current.map((appointment) =>
          appointment.id === editingAppointment.id
            ? {
                ...appointment,
                name: draft.name,
                chartNumber: draft.chartNumber,
                dateOfBirth: draft.dateOfBirth,
                sex: draft.sex,
                careCategory: draft.careCategory,
                procedure: draft.procedure,
                upperSedation: draft.upperSedation,
                colonSedation: draft.colonSedation,
                date: draft.date,
                start: draft.start,
                duration: validation.duration,
                screeningCopay: draft.screeningCopay,
                bowelPreparation:
                  draft.procedure === "위" ? undefined : draft.bowelPreparation,
                medication: draft.medicationsChecked ? "완료" : "대기",
                deposit: draft.depositPaid ? "완료" : "대기",
                afternoonException:
                  draft.bucket === "AFTERNOON_EXCEPTION" || undefined,
                exceptionReason: draft.exceptionReason || undefined,
                exceptionConfirmedBy: draft.exceptionConfirmedBy || undefined,
                memo: draft.exceptionMemo || appointment.memo,
                verification: coreChanged ? "대기" : appointment.verification,
                pacs: coreChanged ? "대기" : appointment.pacs,
                d1: coreChanged ? "대기" : appointment.d1,
              }
            : appointment,
        ),
      );
      setSelectedId(editingAppointment.id);
      notify(
        coreChanged
          ? "예약을 변경했습니다. 핵심정보 변경으로 이중확인을 초기화했습니다."
          : "예약 변경을 저장했습니다.",
      );
    } else {
      const newId = `APT-${String(appointments.length + 1).padStart(3, "0")}`;
      const created: Appointment = {
        id: newId,
        date: draft.date,
        start: draft.start,
        duration: validation.duration,
        name: draft.name,
        chartNumber: draft.chartNumber,
        dateOfBirth: draft.dateOfBirth,
        sex: draft.sex,
        careCategory: draft.careCategory,
        procedure: draft.procedure,
        upperSedation: draft.upperSedation,
        colonSedation: draft.colonSedation,
        screeningCopay: draft.screeningCopay,
        bowelPreparation:
          draft.procedure === "위" ? undefined : draft.bowelPreparation,
        deposit: draft.depositPaid ? "완료" : "대기",
        medication: draft.medicationsChecked ? "완료" : "대기",
        d1: "대기",
        verification: "대기",
        pacs: "대기",
        status: "예약",
        afternoonException:
          draft.bucket === "AFTERNOON_EXCEPTION" || undefined,
        exceptionReason: draft.exceptionReason || undefined,
        exceptionConfirmedBy: draft.exceptionConfirmedBy || undefined,
        memo: draft.exceptionMemo || "합성 데이터 Prototype 등록",
      };
      setAppointments((current) => [...current, created]);
      setSelectedId(newId);
      setActiveView("week");
      notify(`${created.name}님의 합성 예약을 등록했습니다.`);
    }
    setBookingModal(null);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT";

      if ((event.ctrlKey && event.key.toLowerCase() === "k") || event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (bookingModal || drawer || isTyping) return;
      if (event.key === "F2" || event.key.toLowerCase() === "n") {
        event.preventDefault();
        openNewBooking();
      } else if (event.key === "F4" || event.key.toLowerCase() === "e") {
        event.preventDefault();
        openEditBooking();
      } else if (event.key === "F6") {
        event.preventDefault();
        verifySelected();
      } else if (event.key === "Enter" && selectedId) {
        event.preventDefault();
        setDrawer({ kind: "appointment", id: selectedId });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!loggedIn) return <LoginScreen onLogin={() => setLoggedIn(true)} />;

  const renderMainView = () => {
    if (activeView === "today") {
      return (
        <TodayView
          appointments={appointments}
          pathologyCases={pathologyCases}
          onSelect={(id) => {
            setSelectedId(id);
            setDrawer({ kind: "appointment", id });
          }}
        />
      );
    }
    if (activeView === "month") return <MonthView appointments={appointments} />;
    if (activeView === "day") {
      return (
        <DayView
          appointments={appointments}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      );
    }
    if (activeView === "confirmation") {
      return (
        <ConfirmationView
          appointments={appointments}
          onSelect={(id) => {
            setSelectedId(id);
            setDrawer({ kind: "appointment", id });
          }}
        />
      );
    }
    if (activeView === "pathology") {
      return (
        <PathologyLedger
          cases={pathologyCases}
          onSelect={(id) => setDrawer({ kind: "pathology", id })}
        />
      );
    }
    if (activeView === "patient") {
      return <PatientHistoryView appointments={appointments} />;
    }
    if (activeView === "statistics") {
      return <StatisticsView appointments={appointments} />;
    }
    if (activeView === "admin") return <AdminView />;

    return (
      <WeekSchedule
        appointments={appointments}
        selectedId={selectedId}
        onSelect={setSelectedId}
        search={search}
      />
    );
  };

  const drawerAppointment =
    drawer?.kind === "appointment"
      ? appointments.find((appointment) => appointment.id === drawer.id)
      : undefined;
  const drawerPathology =
    drawer?.kind === "pathology"
      ? pathologyCases.find((pathologyCase) => pathologyCase.id === drawer.id)
      : undefined;

  return (
    <div className="app-shell">
      <aside className="navigation-rail" aria-label="주 메뉴">
        <div className="navigation-rail__brand" title="내시경 운영 시스템">
          <BrandMark />
        </div>
        <nav>
          {NAVIGATION.map((item) => (
            <button
              key={item.id}
              className={
                item.id !== "booking" && activeView === item.id ? "is-active" : ""
              }
              onClick={() => {
                if (item.id === "booking") {
                  openNewBooking();
                } else {
                  setActiveView(item.id);
                }
              }}
              title={item.label}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <button
          className="navigation-rail__logout"
          title="로그인 화면 보기"
          onClick={() => setLoggedIn(false)}
        >
          <Icon name="logout" />
          <span>로그아웃</span>
        </button>
      </aside>

      <header className="topbar">
        <div className="topbar__title">
          <h1>내시경 운영 시스템</h1>
          <span>Queue-First Workbench</span>
          <em>합성 데이터</em>
        </div>
        <div className="topbar__actions">
          <button className="primary-button" onClick={openNewBooking}>
            <Icon name="add" />
            새 예약
            <kbd>F2</kbd>
          </button>
          <button className="icon-button" title="알림">
            <Icon name="bell" />
            <span className="notification-dot">3</span>
          </button>
          <button className="profile-button">
            <span className="avatar avatar--small">김</span>
            <span>
              <strong>김지현</strong>
              <small>관리자 · Prototype</small>
            </span>
            <Icon name="chevron" />
          </button>
          <button
            className="session-button"
            title="로그인 화면 보기"
            onClick={() => setLoggedIn(false)}
          >
            <Icon name="logout" />
            <span>
              자동 로그아웃
              <strong>28:15</strong>
            </span>
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="command-bar">
          <div className="date-command">
            <button className="icon-button" title="이전 주">
              <Icon name="previous" />
            </button>
            <strong>2026년 7월 27일 ~ 8월 1일 (31주)</strong>
            <button className="icon-button" title="다음 주">
              <Icon name="next" />
            </button>
            <button
              className="secondary-button"
              onClick={() => setActiveView("today")}
            >
              <Icon name="today" />
              오늘
            </button>
          </div>
          <label className="global-search">
            <Icon name="search" />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="환자명 또는 차트번호 검색"
              aria-label="환자명 또는 차트번호 검색"
            />
            <kbd>Ctrl K</kbd>
          </label>
          <button className="secondary-button print-button" onClick={() => window.print()}>
            <Icon name="print" />
            인쇄
          </button>
        </div>

        {activeView === "week" ? (
          <div className="workbench-grid">
            <PriorityQueue
              appointments={appointments}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            {renderMainView()}
            <Inspector
              appointment={selectedAppointment}
              onOpen={() =>
                selectedAppointment &&
                setDrawer({ kind: "appointment", id: selectedAppointment.id })
              }
              onEdit={() => openEditBooking()}
              onVerify={verifySelected}
            />
          </div>
        ) : (
          <div className="view-wrapper">{renderMainView()}</div>
        )}
      </main>

      {bookingModal && (
        <BookingWizard
          appointment={editingAppointment}
          appointments={appointments}
          onClose={() => setBookingModal(null)}
          onSave={saveBooking}
        />
      )}

      {drawerAppointment && (
        <AppointmentDrawer
          appointment={drawerAppointment}
          onClose={() => setDrawer(null)}
          onEdit={() => openEditBooking(drawerAppointment.id)}
        />
      )}

      {drawerPathology && (
        <PathologyDrawer
          pathologyCase={drawerPathology}
          onClose={() => setDrawer(null)}
          onUpdate={(patch) => {
            setPathologyCases((current) =>
              current.map((pathologyCase) =>
                pathologyCase.id === drawerPathology.id
                  ? { ...pathologyCase, ...patch }
                  : pathologyCase,
              ),
            );
            notify("조직검체 Follow-up 기록을 갱신했습니다.");
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <Icon name="check" />
          {toast}
        </div>
      )}
    </div>
  );
}
