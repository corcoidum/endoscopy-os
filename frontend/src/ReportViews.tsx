import {
  formatAgeSex,
  procedureLabel,
  type Appointment,
} from "./data";
import { StateLabel } from "./uiPrimitives";
import {
  appointmentsForStatisticsPeriod,
  statisticsPeriodLabel,
} from "./calendarDates";
import { Icon } from "./icons";
import type { StatisticsPeriod } from "./viewTypes";

export function ConfirmationView({
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

export function StatisticsView({
  appointments,
  period,
  calendarDate,
  onPeriodChange,
}: {
  appointments: Appointment[];
  period: StatisticsPeriod;
  calendarDate: string;
  onPeriodChange: (period: StatisticsPeriod) => void;
}) {
  const scopedAppointments = appointmentsForStatisticsPeriod(
    appointments,
    period,
    calendarDate,
  );
  const standard = scopedAppointments.filter((item) => !item.afternoonException);
  const exception = scopedAppointments.filter((item) => item.afternoonException);
  const count = (items: Appointment[], procedure: "upper" | "colon") =>
    items.filter((item) =>
      procedure === "upper"
        ? item.procedure === "위" || item.procedure === "위·대장"
        : item.procedure === "대장" || item.procedure === "위·대장",
    ).length;
  const sedationCounts = (procedure: "upper" | "colon") => {
    const matching = scopedAppointments.filter((item) =>
      procedure === "upper"
        ? item.procedure === "위" || item.procedure === "위·대장"
        : item.procedure === "대장" || item.procedure === "위·대장",
    );
    const sedationKey = procedure === "upper" ? "upperSedation" : "colonSedation";
    return {
      total: matching.length,
      sedated: matching.filter((item) => item[sedationKey] === true).length,
      nonSedated: matching.filter((item) => item[sedationKey] === false).length,
    };
  };
  const upper = sedationCounts("upper");
  const colon = sedationCounts("colon");
  const periodName = period === "week" ? "주간" : period === "month" ? "월간" : "연간";
  return (
    <section className="view-surface">
      <div className="view-title">
        <div>
          <span className="eyebrow">환자 수와 검사 건수 분리</span>
          <h1>{periodName} 운영 통계</h1>
          <p>일반 오전과 오후 예외를 분리하고, 검사별 수면 여부를 집계합니다.</p>
        </div>
        <div className="statistics-period-tabs" aria-label="통계 조회 기간">
          {(["week", "month", "year"] as const).map((item) => (
            <button
              type="button"
              className={period === item ? "is-active" : ""}
              aria-pressed={period === item}
              onClick={() => onPeriodChange(item)}
              key={item}
            >
              {item === "week" ? "주간" : item === "month" ? "월간" : "연간"}
            </button>
          ))}
        </div>
      </div>
      <div className="statistics-scope-note">
        <Icon name="statistics" />
        <span>{statisticsPeriodLabel(period, calendarDate)}</span>
        <small>Prototype 예약 데이터 기준 · 위·대장 동시 예약은 검사별 1건씩 집계</small>
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
          <span className="eyebrow">PERIOD TOTAL</span>
          <h2>기간 내 전체 예약</h2>
          <dl className="stat-definition">
            <div>
              <dt>환자</dt>
              <dd>{scopedAppointments.length}</dd>
            </div>
            <div>
              <dt>위내시경</dt>
              <dd>{count(scopedAppointments, "upper")}</dd>
            </div>
            <div>
              <dt>대장내시경</dt>
              <dd>{count(scopedAppointments, "colon")}</dd>
            </div>
          </dl>
        </article>
      </div>
      <div className="statistics-section-heading">
        <div>
          <span className="eyebrow">SEDATION BREAKDOWN</span>
          <h2>검사별 수면·비수면</h2>
        </div>
        <p>예약 시 선택한 위·대장 각각의 수면 여부를 기준으로 계산합니다.</p>
      </div>
      <div className="procedure-statistics-grid">
        {([
          { label: "위내시경", stats: upper, tone: "upper" },
          { label: "대장내시경", stats: colon, tone: "colon" },
        ] as const).map(({ label, stats, tone }) => (
          <article className={`procedure-stat-card procedure-stat-card--${tone}`} key={label}>
            <div className="procedure-stat-card__header">
              <div>
                <span>{label}</span>
                <strong>{stats.total}건</strong>
              </div>
              <em>{stats.total === 0 ? "집계 없음" : "예약 기준"}</em>
            </div>
            <dl className="procedure-stat-card__breakdown">
              <div>
                <dt>수면</dt>
                <dd>{stats.sedated}</dd>
                <span>{stats.total ? `${Math.round((stats.sedated / stats.total) * 100)}%` : "0%"}</span>
              </div>
              <div>
                <dt>비수면</dt>
                <dd>{stats.nonSedated}</dd>
                <span>{stats.total ? `${Math.round((stats.nonSedated / stats.total) * 100)}%` : "0%"}</span>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

export function AdminView() {
  const settings = [
    {
      title: "요일별 운영시간",
      description: "월·화·목·금 09:00~12:00 / 수·토 09:00~11:00",
      value: "적용 중",
    },
    {
      title: "검사 소요시간",
      description: "위 30분 / 대장 60분 / 위·대장 세트60·세트90 선택",
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
