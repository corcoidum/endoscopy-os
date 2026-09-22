import type { CSSProperties } from "react";
import {
  formatAgeSex,
  procedureLabel,
  type Appointment,
  type PathologyCase,
} from "./data";
import {
  fromMinutes,
  hasShortenedMorning,
  morningEndLabel,
  toMinutes,
} from "./scheduler";
import {
  AppStatusMark,
  procedureTone,
  StateLabel,
} from "./uiPrimitives";
import {
  addCalendarDays,
  koreanDateLabel,
  monthGridDays,
  parseIsoDate,
  startOfCalendarWeek,
  weekDaysFor,
} from "./calendarDates";
import { Icon } from "./icons";
import type { DayPolicyLookup } from "./dayPolicies";
import { VERIFICATION_STATE_LABELS } from "./verificationsApi";

export function AppointmentCard({
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
        appointment.sameDay ? "appointment-card--same-day" : ""
      } ${
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
        {appointment.procedure === "위·대장" && (
          <span className="mini-tag">{appointment.procedureSet ?? `세트${appointment.duration}`}</span>
        )}
        {isAfternoon && <span className="mini-tag">예외</span>}
        {appointment.sameDay && <span className="mini-tag">당일추가</span>}
        {appointment.sameDayExtension && <span className="mini-tag">연장슬롯</span>}
      </span>
      <span className="appointment-card__identity">
        <strong title={appointment.name}>{appointment.name}</strong>
        <small title={appointment.chartNumber}>{appointment.chartNumber}</small>
      </span>
      <span className="appointment-card__procedure">
        <span className={`procedure-chip procedure-chip--${procedureTone(appointment.procedure)}`}>
          {procedureLabel(appointment)}
        </span>
        <span className="appointment-card__demographic">
          {formatAgeSex(appointment)}
        </span>
      </span>
      <span className="appointment-card__status">
        {/* 실제 예약은 연결된 이중확인만 보여 준다. 약제·D-1·예약금은 아직 미연결이다. */}
        {!appointment.backendManaged && (
          <AppStatusMark icon="medication" state={appointment.medication} label="약제" />
        )}
        {!appointment.backendManaged && (
          <AppStatusMark icon="phone" state={appointment.d1} label="D-1" />
        )}
        <AppStatusMark icon="check" state={appointment.verification} label="이중확인" />
        {!appointment.backendManaged && (
          <AppStatusMark icon="deposit" state={appointment.deposit} label="예약금" />
        )}
      </span>
    </button>
  );
}

export function TimeAxis() {
  const morningTimes = [
    "09:00", "09:30", "10:00", "10:30", "11:00",
    "11:30", "12:00", "12:30", "13:00", "13:30",
  ];
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

export function WeekSchedule({
  appointments,
  selectedId,
  onSelect,
  calendarDate,
  onSelectDate,
  dayPolicy,
  loading,
  loadError,
  onRetry,
}: {
  appointments: Appointment[];
  selectedId?: string;
  onSelect: (id: string) => void;
  calendarDate: string;
  onSelectDate: (date: string) => void;
  dayPolicy: DayPolicyLookup;
  loading: boolean;
  loadError: string;
  onRetry: () => void;
}) {
  const weekDays = weekDaysFor(calendarDate);
  const filteredAppointments = appointments;

  return (
    <section className="schedule-panel" aria-label="월요일부터 토요일 주간 일정">
      <div className={`backend-boundary ${loadError ? "is-error" : ""}`} role="status">
        <span>
          <strong>Backend 일정</strong>
          {loading
            ? "주간 예약을 불러오는 중입니다."
            : loadError || "로그인 권한으로 조회한 저장 예약입니다."}
        </span>
        {loadError && (
          <button type="button" className="secondary-button" onClick={onRetry}>
            다시 조회
          </button>
        )}
      </div>
      <div className="print-title">
        <strong>내시경 주간 일정</strong>
        <span>{startOfCalendarWeek(calendarDate)} ~ {addCalendarDays(startOfCalendarWeek(calendarDate), 5)} · 원내업무용 · 사용 후 파쇄</span>
      </div>
      <div className="week-board">
        <div className="week-board__corner">시간</div>
        {weekDays.map((day) => {
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
            <button
              type="button"
              className={`day-heading ${day.today ? "is-today" : ""}`}
              key={day.date}
              onClick={() => onSelectDate(day.date)}
              title={`${day.label} 일간 보기`}
            >
              <span>
                {day.label}
                {day.today && <em>오늘</em>}
              </span>
              <small>
                환자 {dayAppointments.length} · 위 {upperCount} · 대장 {colonCount}
              </small>
            </button>
          );
        })}
        <TimeAxis />
        {weekDays.map((day) => {
          const dayAppointments = filteredAppointments.filter(
            (appointment) => appointment.date === day.date,
          );
          return (
            <div
              className={`day-column ${day.today ? "is-today" : ""}`}
              key={day.date}
            >
              <div className="slot-lines" aria-hidden="true">
                {Array.from({ length: 11 }, (_, index) => (
                  <span
                    style={{ "--slot-index": index } as CSSProperties}
                    key={index}
                  />
                ))}
              </div>
              {hasShortenedMorning(dayPolicy(day.date)) && (
                <div className="closed-morning">
                  <Icon name="lock" />
                  <span>{morningEndLabel(dayPolicy(day.date))} 오전 운영 종료</span>
                </div>
              )}
              {dayAppointments.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  selected={selectedId === appointment.id}
                  onSelect={() => onSelect(appointment.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DashboardMetrics({
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

export function TodayView({
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

export function MonthView({
  appointments,
  calendarDate,
  selectedDate,
  onSelectDate,
}: {
  appointments: Appointment[];
  calendarDate: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const { year, month, days } = monthGridDays(calendarDate);

  return (
    <section className="view-surface">
      <div className="view-title">
        <div>
          <span className="eyebrow">월간 Capacity</span>
          <h1>{year}년 {month + 1}월</h1>
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
            <button
              type="button"
              className={`month-cell ${!day.currentMonth ? "is-muted" : ""} ${
                day.sunday ? "is-closed" : ""
              } ${day.iso === selectedDate ? "is-selected" : ""}`}
              key={day.iso}
              onClick={() => onSelectDate(day.iso)}
              aria-label={`${koreanDateLabel(day.iso)} 일간 보기`}
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
                <small>예약 없음</small>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function appointmentServiceLabels(appointment: Appointment): string[] {
  const labels: string[] = [];
  if (appointment.careCategory === "검진" || appointment.generalScreening === "실시") {
    labels.push("일반검진");
  }
  labels.push(
    ...(appointment.additionalExaminations ?? []).filter((item) =>
      item.endsWith("초음파"),
    ),
  );
  return labels;
}

export function DayView({
  appointments,
  selectedId,
  onSelect,
  calendarDate,
}: {
  appointments: Appointment[];
  selectedId?: string;
  onSelect: (id: string) => void;
  calendarDate: string;
}) {
  const todayAppointments = appointments
    .filter((appointment) => appointment.date === calendarDate)
    .sort((first, second) => first.start.localeCompare(second.start));
  const serviceSummary = [
    "일반검진",
    "복부초음파",
    "갑상선초음파",
    "심장초음파",
    "경동맥초음파",
  ].map((label) => ({
    label,
    count: todayAppointments.filter((appointment) =>
      appointmentServiceLabels(appointment).includes(label),
    ).length,
  }));
  const date = parseIsoDate(calendarDate);

  return (
    <section className="view-surface">
      <div className="view-title">
        <div>
          <span className="eyebrow">당일 검사 업무</span>
          <h1>{date.getMonth() + 1}월 {date.getDate()}일 일간</h1>
          <p>내시경과 일반검진·초음파 시행 항목을 시간순으로 한 번에 봅니다.</p>
        </div>
      </div>
      <div className="day-summary" aria-label="당일 검사 대상자 요약">
        <div className="day-summary__total">
          <span>검사 대상자</span>
          <strong>{todayAppointments.length}명</strong>
        </div>
        {serviceSummary.map((item) => (
          <div key={item.label} className={item.count > 0 ? "has-items" : ""}>
            <span>{item.label}</span>
            <strong>{item.count}명</strong>
          </div>
        ))}
      </div>
      <div className="day-workbench">
        <div className="day-timeline">
          {todayAppointments.length === 0 ? (
            <div className="day-empty">선택한 날짜에 등록된 검사 대상자가 없습니다.</div>
          ) : todayAppointments.map((appointment) => (
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
              <span className="day-row__services">
                {appointmentServiceLabels(appointment).length > 0
                  ? appointmentServiceLabels(appointment).map((label) => (
                      <em key={label}>{label}</em>
                    ))
                  : <small>추가 시행 없음</small>}
              </span>
              {/* 실제 예약은 재확인 필요·1차·2차 대기를 구분해 보여 준다. */}
              <StateLabel
                state={appointment.verification}
                label={
                  appointment.verificationState
                    ? VERIFICATION_STATE_LABELS[appointment.verificationState]
                    : undefined
                }
              />
              {/* PACS는 업무 흐름이 정해질 때까지 실제 예약에서 숨긴다. */}
              {appointment.backendManaged ? <span /> : <StateLabel state={appointment.pacs} />}
            </button>
          ))}
        </div>
        <div className="pacs-panel">
          {/* PACS 확인은 아직 구현하지 않아 이 안내에서도 드러내지 않는다. */}
          <span className="eyebrow">인적사항 이중확인</span>
          <h2>핵심정보 이중확인</h2>
          <p>예약을 누르면 상세에서 이름·차트번호·생년월일·성별·검사·수면을 1·2차로 확인합니다.</p>
          <div className="safety-banner">
            <Icon name="shield" />
            2차 확인 후 핵심정보가 수정되면 기존 확인은 자동 무효화됩니다.
          </div>
        </div>
      </div>
    </section>
  );
}
