import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { calendarQueries } from "./calendarQueries";
import {
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
  dayAvailability,
  formatBirthDateInput,
  fromMinutes,
  isDepositSelectionComplete,
  isShortMorning,
  isValidBirthDate,
  MORNING_COLON_CAPACITY,
  MORNING_UPPER_CAPACITY,
  procedureDuration,
  standardStartsFor,
  toMinutes,
  validateBooking,
  validateSchedule,
  type BookingDraft,
  type ValidationResult,
} from "./scheduler";
import { useAuth } from "./auth";
import { PatientWorkspace } from "./PatientWorkspace";
import { AppointmentOperationsEditor } from "./AppointmentOperationsEditor";
import type {
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
} from "./api";
import { ApiError } from "./api";
import {
  appointmentsApi,
  bookingCreateErrorMessage,
  mapAppointmentResponse,
  type ScheduleAvailabilityResponse,
} from "./appointmentsApi";

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

type StatisticsPeriod = "week" | "month" | "year";

type DrawerState =
  | { kind: "appointment"; id: string }
  | { kind: "pathology"; id: string }
  | null;

// 24x24 Grid 위에 그린 Stroke Icon이다. Windows 전용 "Segoe Fluent Icons"에
// 의존하면 macOS·iPad 같은 다른 원내 기기에서 모든 Icon이 빈 사각형으로 보이므로
// Application이 직접 가진 Vector로 그린다.
const ICONS: Record<string, string[]> = {
  today: [
    "M4.5 7a2 2 0 012-2h11a2 2 0 012 2v11a2 2 0 01-2 2h-11a2 2 0 01-2-2z",
    "M4.5 9.75h15",
    "M8.5 3v3.5",
    "M15.5 3v3.5",
    "M12 14.75h.01",
  ],
  month: [
    "M4.5 7a2 2 0 012-2h11a2 2 0 012 2v11a2 2 0 01-2 2h-11a2 2 0 01-2-2z",
    "M4.5 9.75h15",
    "M8.5 3v3.5",
    "M15.5 3v3.5",
    "M8.75 13h.01",
    "M15.25 13h.01",
    "M8.75 16.5h.01",
    "M15.25 16.5h.01",
  ],
  week: [
    "M4.5 7a2 2 0 012-2h11a2 2 0 012 2v11a2 2 0 01-2 2h-11a2 2 0 01-2-2z",
    "M4.5 9.75h15",
    "M8.5 3v3.5",
    "M15.5 3v3.5",
    "M9.75 9.75V20",
    "M14.25 9.75V20",
  ],
  day: [
    "M4.5 7a2 2 0 012-2h11a2 2 0 012 2v11a2 2 0 01-2 2h-11a2 2 0 01-2-2z",
    "M4.5 9.75h15",
    "M8.5 3v3.5",
    "M15.5 3v3.5",
    "M8.25 13.5h7.5",
    "M8.25 17h4.5",
  ],
  add: ["M12 5.25v13.5", "M5.25 12h13.5"],
  confirmation: [
    "M9.5 4.75H7.5a2 2 0 00-2 2v12a2 2 0 002 2h9a2 2 0 002-2v-12a2 2 0 00-2-2h-2",
    "M9.5 4.75V4a1 1 0 011-1h3a1 1 0 011 1v.75z",
    "M8.75 13.25l2.25 2.25 4.25-4.5",
  ],
  pathology: [
    "M10 3v5.4l-4.6 8.4a2 2 0 001.8 3h9.6a2 2 0 001.8-3L14 8.4V3",
    "M9 3h6",
    "M7.6 14.2h8.8",
  ],
  patient: [
    "M12 11.5a3.6 3.6 0 100-7.2 3.6 3.6 0 000 7.2z",
    "M4.75 20.25a7.25 7.25 0 0114.5 0",
  ],
  statistics: [
    "M4.5 20h15",
    "M8 20v-5.5",
    "M12 20v-10",
    "M16 20v-3.5",
  ],
  admin: [
    "M4.5 7h6.5",
    "M15 7h4.5",
    "M4.5 12h4",
    "M12.5 12h7",
    "M4.5 17h6.5",
    "M15 17h4.5",
    "M13 7a2 2 0 10-4 0 2 2 0 004 0z",
    "M10.5 12a2 2 0 104 0 2 2 0 00-4 0z",
    "M13 17a2 2 0 10-4 0 2 2 0 004 0z",
  ],
  search: [
    "M11 18a7 7 0 100-14 7 7 0 000 14z",
    "M16.1 16.1l4.4 4.4",
  ],
  previous: ["M14.5 6.25L8.75 12l5.75 5.75"],
  next: ["M9.5 6.25L15.25 12 9.5 17.75"],
  bell: [
    "M12 3.5a5.5 5.5 0 015.5 5.5v3.3l1.3 2.4a.8.8 0 01-.7 1.2H5.9a.8.8 0 01-.7-1.2l1.3-2.4V9A5.5 5.5 0 0112 3.5z",
    "M10 19a2 2 0 004 0",
  ],
  logout: [
    "M14.75 8.5V6.25a1.75 1.75 0 00-1.75-1.75H6.25A1.75 1.75 0 004.5 6.25v11.5A1.75 1.75 0 006.25 19.5H13a1.75 1.75 0 001.75-1.75V15.5",
    "M10.5 12h9",
    "M16.5 8.75L19.75 12l-3.25 3.25",
  ],
  filter: ["M4.5 6.5h15", "M7.5 12h9", "M10.5 17.5h3"],
  refresh: [
    "M19.5 12a7.5 7.5 0 11-2.35-5.45",
    "M19.5 4.25V9h-4.75",
  ],
  warning: [
    "M12 4.75l8 14.25H4z",
    "M12 10.25v3.75",
    "M12 16.5h.01",
  ],
  check: ["M5.5 12.75l4.25 4.25L18.5 7.5"],
  phone: [
    "M7.3 4.5h2.2l1.3 3.3-1.8 1.3a11 11 0 005.9 5.9l1.3-1.8 3.3 1.3v2.2a2 2 0 01-2.2 2A15.5 15.5 0 015.3 6.7a2 2 0 012-2.2z",
  ],
  medication: [
    "M14.5 5.3a4 4 0 015.7 5.7l-9.2 9.2a4 4 0 01-5.7-5.7z",
    "M9.9 10l4.5 4.5",
  ],
  deposit: [
    "M3.75 7.5a2 2 0 012-2h12.5a2 2 0 012 2v9a2 2 0 01-2 2H5.75a2 2 0 01-2-2z",
    "M3.75 10.5h16.5",
    "M7 14.5h3.5",
  ],
  close: ["M6.5 6.5l11 11", "M17.5 6.5l-11 11"],
  edit: [
    "M4.5 19.5h4l10-10a2.12 2.12 0 00-3-3l-10 10z",
    "M14.5 7.5l3 3",
  ],
  detail: [
    "M6.5 3.5h7L19 9v11a1 1 0 01-1 1H6.5a1 1 0 01-1-1V4.5a1 1 0 011-1z",
    "M13.5 3.5V9H19",
    "M9 13h6",
    "M9 16.5h6",
  ],
  shield: [
    "M12 3.5l7 2.6v5.2c0 4.3-2.8 7.6-7 9.2-4.2-1.6-7-4.9-7-9.2V6.1z",
    "M9 12l2.25 2.25L15.25 10",
  ],
  print: [
    "M7.5 9.5V4.5h9v5",
    "M7.5 17.5h-2A1.5 1.5 0 014 16v-4.5A1.5 1.5 0 015.5 10h13a1.5 1.5 0 011.5 1.5V16a1.5 1.5 0 01-1.5 1.5h-2",
    "M7.5 14.5h9v5h-9z",
  ],
  lock: [
    "M7.75 10.5V8a4.25 4.25 0 018.5 0v2.5",
    "M6 10.5h12a1 1 0 011 1v7a1 1 0 01-1 1H6a1 1 0 01-1-1v-7a1 1 0 011-1z",
  ],
  chevron: ["M9.5 6.25L15.25 12 9.5 17.75"],
  clock: [
    "M12 20a8 8 0 100-16 8 8 0 000 16z",
    "M12 7.5V12l3 1.9",
  ],
  history: [
    "M4.5 12a7.5 7.5 0 112.6 5.7",
    "M4.5 7.25V12H9",
    "M12 8.5V12l2.8 1.7",
  ],
  info: [
    "M12 20a8 8 0 100-16 8 8 0 000 16z",
    "M12 11.25v4.75",
    "M12 8.25h.01",
  ],
  menu: ["M4.5 7h15", "M4.5 12h15", "M4.5 17h15"],
};

const NAVIGATION: Array<{
  id: ViewId | "booking";
  label: string;
  icon: string;
  permissions: string[];
}> = [
  { id: "today", label: "오늘", icon: "today", permissions: ["appointment.read"] },
  { id: "month", label: "월간", icon: "month", permissions: ["appointment.read"] },
  { id: "week", label: "주간", icon: "week", permissions: ["appointment.read"] },
  { id: "day", label: "일간", icon: "day", permissions: ["appointment.read"] },
  {
    id: "booking",
    label: "예약 등록",
    icon: "add",
    permissions: ["appointment.create"],
  },
  {
    id: "confirmation",
    label: "확인 업무",
    icon: "confirmation",
    permissions: [
      "appointment.update",
      "verification.secondary",
      "verification.pacs",
      "procedure.write",
    ],
  },
  {
    id: "pathology",
    label: "조직검체",
    icon: "pathology",
    permissions: ["pathology.read"],
  },
  {
    id: "patient",
    label: "환자 History",
    icon: "patient",
    permissions: ["patient.read"],
  },
  {
    id: "statistics",
    label: "통계",
    icon: "statistics",
    permissions: ["appointment.read"],
  },
  {
    id: "admin",
    label: "관리자",
    icon: "admin",
    permissions: [
      "schedule_override.approve",
      "identity.manage",
      "audit.read",
      "backup.read",
      "backup.run",
    ],
  },
];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "관리자",
  FRONT_DESK: "원무 담당자",
  ENDOSCOPY_STAFF: "내시경 담당자",
  READ_ONLY: "조회 전용",
};

const REFERENCE_TODAY = "2026-09-18";
const KOREAN_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function seoulTodayIso(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addCalendarDays(value: string, amount: number): string {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + amount);
  return toIsoDate(date);
}

function addCalendarMonths(value: string, amount: number): string {
  const date = parseIsoDate(value);
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  return toIsoDate(date);
}

function addCalendarYears(value: string, amount: number): string {
  const date = parseIsoDate(value);
  date.setFullYear(date.getFullYear() + amount);
  return toIsoDate(date);
}

function startOfCalendarWeek(value: string): string {
  const date = parseIsoDate(value);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return toIsoDate(date);
}

function weekDaysFor(value: string) {
  const monday = startOfCalendarWeek(value);
  return Array.from({ length: 6 }, (_, index) => {
    const iso = addCalendarDays(monday, index);
    const date = parseIsoDate(iso);
    return {
      date: iso,
      label: `${KOREAN_WEEKDAYS[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}`,
      today: iso === REFERENCE_TODAY,
    };
  });
}

function monthGridDays(value: string) {
  const visibleMonth = parseIsoDate(value);
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const leadingDays = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
  const days = Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(year, month, 1 + index - leadingDays);
    return {
      iso: toIsoDate(date),
      day: date.getDate(),
      currentMonth: date.getMonth() === month,
      sunday: date.getDay() === 0,
    };
  });
  return { year, month, days };
}

function koreanDateLabel(value: string): string {
  const date = parseIsoDate(value);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${KOREAN_WEEKDAYS[date.getDay()]}요일`;
}

function periodLabel(view: ViewId, value: string): string {
  const date = parseIsoDate(value);
  if (view === "month") return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
  if (view === "day") return koreanDateLabel(value);
  const monday = startOfCalendarWeek(value);
  const saturday = addCalendarDays(monday, 5);
  const mondayDate = parseIsoDate(monday);
  const saturdayDate = parseIsoDate(saturday);
  const weekNumber = Math.ceil(
    ((mondayDate.getTime() - new Date(mondayDate.getFullYear(), 0, 1).getTime()) /
      86400000 +
      new Date(mondayDate.getFullYear(), 0, 1).getDay() +
      1) /
      7,
  );
  return `${mondayDate.getFullYear()}년 ${mondayDate.getMonth() + 1}월 ${mondayDate.getDate()}일 ~ ${saturdayDate.getMonth() + 1}월 ${saturdayDate.getDate()}일 (${weekNumber}주)`;
}

function statisticsPeriodLabel(period: StatisticsPeriod, value: string): string {
  const date = parseIsoDate(value);
  if (period === "month") {
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
  }
  if (period === "year") return `${date.getFullYear()}년`;
  return periodLabel("week", value);
}

function appointmentsForStatisticsPeriod(
  appointments: Appointment[],
  period: StatisticsPeriod,
  value: string,
): Appointment[] {
  if (period === "year") {
    return appointments.filter((item) => item.date.startsWith(`${value.slice(0, 4)}-`));
  }
  if (period === "month") {
    return appointments.filter((item) => item.date.startsWith(value.slice(0, 7)));
  }
  const start = startOfCalendarWeek(value);
  const end = addCalendarDays(start, 5);
  return appointments.filter((item) => item.date >= start && item.date <= end);
}

function hasAnyPermission(user: AuthUser, permissions: string[]) {
  return (
    user.permissions.includes("*") ||
    permissions.some((permission) => user.permissions.includes(permission))
  );
}

function roleLabel(roles: string[]) {
  if (roles.length === 0) return "권한 확인 필요";
  return roles.map((role) => ROLE_LABELS[role] ?? role).join(" · ");
}

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
  const paths = ICONS[name] ?? ICONS.info;
  return (
    <span
      className={`app-icon ${className}`}
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        {paths.map((path) => (
          <path key={path} d={path} />
        ))}
      </svg>
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

function LoginScreen({
  onLogin,
  isSubmitting,
  error,
  notice,
}: {
  onLogin: (credentials: LoginRequest) => Promise<boolean>;
  isSubmitting: boolean;
  error: string;
  notice: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");

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
            void onLogin({ login_id: loginId, password });
          }}
        >
          <label className="field">
            <span>ID</span>
            <input
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={isSubmitting}
              autoFocus
            />
          </label>
          <label className="field">
            <span>Password</span>
            <span className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="text-button"
                onClick={() => setShowPassword((current) => !current)}
                disabled={isSubmitting}
              >
                {showPassword ? "숨김" : "표시"}
              </button>
            </span>
          </label>
          {notice ? (
            <div className="login-feedback login-feedback--notice" role="status">
              <Icon name="info" />
              <span>{notice}</span>
            </div>
          ) : null}
          {error ? (
            <div className="login-feedback login-feedback--error" role="alert">
              <Icon name="warning" />
              <span>{error}</span>
            </div>
          ) : null}
          <div className="login-card__notice">
            <Icon name="clock" />
            <span>30분 동안 사용하지 않으면 자동 로그아웃됩니다.</span>
          </div>
          <button
            className="primary-button primary-button--wide"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "로그인 확인 중…" : "로그인"}
          </button>
        </form>
        <p className="prototype-note">
          합성 데이터 Prototype · 실제 환자정보를 입력하지 마세요.
        </p>
      </section>
    </main>
  );
}

function ForcedPasswordChangeScreen({
  user,
  onChangePassword,
  onLogout,
  isSubmitting,
  error,
}: {
  user: AuthUser;
  onChangePassword: (payload: ChangePasswordRequest) => Promise<boolean>;
  onLogout: () => Promise<boolean>;
  isSubmitting: boolean;
  error: string;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [localError, setLocalError] = useState("");

  const submitPasswordChange = async () => {
    setLocalError("");
    if (!currentPassword || !newPassword || !newPasswordConfirmation) {
      setLocalError("모든 Password 입력란을 작성해 주세요.");
      return;
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      setLocalError("새 Password는 12~128자로 입력해 주세요.");
      return;
    }
    if (currentPassword === newPassword) {
      setLocalError("새 Password는 현재 Password와 달라야 합니다.");
      return;
    }
    if (newPassword !== newPasswordConfirmation) {
      setLocalError("새 Password와 확인 입력값이 일치하지 않습니다.");
      return;
    }

    await onChangePassword({
      current_password: currentPassword,
      new_password: newPassword,
    });
  };

  return (
    <main className="login-screen">
      <section
        className="login-card password-change-card"
        aria-labelledby="password-change-title"
      >
        <div className="login-card__brand">
          <BrandMark />
          <div>
            <strong>내시경 운영 시스템</strong>
            <span>Clinic Endoscopy Operations</span>
          </div>
        </div>
        <div className="login-card__intro">
          <span className="eyebrow">최초 로그인 보안 설정</span>
          <h1 id="password-change-title">Password 변경 필요</h1>
          <p>
            임시 Password를 변경한 후 원내 업무 화면을 사용할 수 있습니다.
          </p>
        </div>
        <div className="password-change-user" aria-label="현재 로그인 사용자">
          <span className="avatar avatar--small">
            {user.display_name.slice(0, 1)}
          </span>
          <span>
            <strong>{user.display_name}</strong>
            <small>{user.login_id}</small>
          </span>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitPasswordChange();
          }}
        >
          <label className="field">
            <span>현재 Password</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              maxLength={128}
              disabled={isSubmitting}
              autoFocus
            />
          </label>
          <label className="field">
            <span>새 Password</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              aria-describedby="password-policy"
              disabled={isSubmitting}
            />
          </label>
          <label className="field">
            <span>새 Password 확인</span>
            <input
              type="password"
              value={newPasswordConfirmation}
              onChange={(event) =>
                setNewPasswordConfirmation(event.target.value)
              }
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              disabled={isSubmitting}
            />
          </label>
          <div className="password-policy" id="password-policy">
            <Icon name="shield" />
            <span>
              12~128자로 입력하고 현재 Password와 다르게 설정해 주세요.
            </span>
          </div>
          {localError || error ? (
            <div className="login-feedback login-feedback--error" role="alert">
              <Icon name="warning" />
              <span>{localError || error}</span>
            </div>
          ) : null}
          <button
            className="primary-button primary-button--wide"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Password 변경 중…" : "변경하고 업무 시작"}
          </button>
          <button
            className="secondary-button secondary-button--wide"
            type="button"
            onClick={() => void onLogout()}
            disabled={isSubmitting}
          >
            <Icon name="logout" />
            로그아웃
          </button>
        </form>
        <p className="prototype-note">
          Password는 Browser 저장소에 보관하지 않습니다.
        </p>
      </section>
    </main>
  );
}

function AuthLoadingScreen() {
  return (
    <main className="login-screen">
      <section
        className="login-card auth-status-card"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="login-card__brand">
          <BrandMark />
          <div>
            <strong>내시경 운영 시스템</strong>
            <span>Clinic Endoscopy Operations</span>
          </div>
        </div>
        <div className="auth-status-card__content">
          <span className="auth-spinner" aria-hidden="true" />
          <h1>로그인 상태 확인 중</h1>
          <p>원내 서버의 보안 세션을 확인하고 있습니다.</p>
        </div>
      </section>
    </main>
  );
}

function AuthUnavailableScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="login-screen">
      <section className="login-card auth-status-card" role="alert">
        <div className="login-card__brand">
          <BrandMark />
          <div>
            <strong>내시경 운영 시스템</strong>
            <span>Clinic Endoscopy Operations</span>
          </div>
        </div>
        <div className="auth-status-card__content auth-status-card__content--error">
          <Icon name="warning" />
          <h1>원내 서버 연결 확인 필요</h1>
          <p>{message}</p>
          <button className="primary-button" type="button" onClick={onRetry}>
            <Icon name="refresh" />
            다시 확인
          </button>
        </div>
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
        <AppStatusMark icon="medication" state={appointment.medication} label="약제" />
        <AppStatusMark icon="phone" state={appointment.d1} label="D-1" />
        <AppStatusMark icon="check" state={appointment.verification} label="이중확인" />
        <AppStatusMark icon="deposit" state={appointment.deposit} label="예약금" />
      </span>
    </button>
  );
}

function TimeAxis() {
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

function WeekSchedule({
  appointments,
  selectedId,
  onSelect,
  calendarDate,
  onSelectDate,
  loading,
  loadError,
  onRetry,
}: {
  appointments: Appointment[];
  selectedId?: string;
  onSelect: (id: string) => void;
  calendarDate: string;
  onSelectDate: (date: string) => void;
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
              {isShortMorning(day.date) && (
                <div className="closed-morning">
                  <Icon name="lock" />
                  <span>11:00 오전 운영 종료</span>
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

function Inspector({
  appointment,
  onOpen,
  onEdit,
  onVerify,
  canEdit,
  canVerify,
}: {
  appointment?: Appointment;
  onOpen: () => void;
  onEdit: () => void;
  onVerify: () => void;
  canEdit: boolean;
  canVerify: boolean;
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
        {canEdit ? (
          <button
            className="secondary-button secondary-button--wide"
            onClick={onEdit}
          >
            <Icon name="edit" />
            예약 변경
            <kbd>F4</kbd>
          </button>
        ) : null}
        {canVerify ? (
          <button
            className="primary-button primary-button--wide"
            onClick={onVerify}
          >
            <Icon name="check" />
            2차 확인
            <kbd>F6</kbd>
          </button>
        ) : null}
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

function MonthView({
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

function appointmentServiceLabels(appointment: Appointment): string[] {
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

function DayView({
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

function StatisticsView({
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

function AdminView() {
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

function draftFromAppointment(
  appointment?: Appointment,
  bookingOrigin: BookingDraft["bookingOrigin"] = "ADVANCE",
): BookingDraft {
  if (appointment) {
    return {
      id: appointment.id,
      name: appointment.name,
      chartNumber: appointment.chartNumber,
      dateOfBirth: appointment.dateOfBirth,
      sex: appointment.sex,
      careCategory: appointment.careCategory,
      procedure: appointment.procedure,
      procedureSet:
        appointment.procedureSet ?? (appointment.duration === 90 ? "세트90" : "세트60"),
      upperSedation: appointment.upperSedation ?? false,
      colonSedation: appointment.colonSedation ?? false,
      date: appointment.date,
      start: appointment.start,
      bucket: appointment.afternoonException
        ? "AFTERNOON_EXCEPTION"
        : appointment.sameDayExtension
          ? "SAME_DAY_EXTENSION"
        : "STANDARD_MORNING",
      bookingOrigin: appointment.sameDay ? "SAME_DAY" : "ADVANCE",
      additionalSlotId: appointment.additionalSlotId,
      sameDayReason: appointment.sameDayReason ?? "",
      sameDayPreparationConfirmed: appointment.sameDayPreparationConfirmed ?? false,
      sameDayClinicianConfirmed: appointment.sameDayClinicianConfirmed ?? false,
      sameDayEscortConfirmed: appointment.sameDayEscortConfirmed ?? false,
      screeningCopay: appointment.screeningCopay ?? "없음",
      bowelPreparation: appointment.bowelPreparation ?? "원프렙",
      medicationsChecked: appointment.medication === "완료",
      medicationListMemo: appointment.medicationListMemo ?? "",
      medicationDiscontinuations:
        appointment.medicationDiscontinuations?.map((medication, index) => ({
          id: `existing-medication-${index + 1}`,
          medicationName: medication.medicationName,
          discontinuationDays: medication.discontinuationDays.toString(),
          doctorConfirmed: medication.doctorConfirmed,
        })) ??
        [
          {
            id: "existing-medication-1",
            medicationName: appointment.medicationDiscontinuationName ?? "",
            discontinuationDays:
              appointment.medicationDiscontinuationDays?.toString() ?? "",
            doctorConfirmed: appointment.medicationDoctorConfirmed ?? false,
          },
        ],
      additionalExaminations: appointment.additionalExaminations ?? [],
      depositStatus:
        appointment.deposit === "완료"
          ? "PAID"
          : appointment.depositUnpaidConfirmed
            ? "UNPAID"
            : "UNSELECTED",
      depositPaymentMethod: appointment.depositPaymentMethod ?? "미확인",
      depositAmount: appointment.depositAmount,
      additionalPrepayment: appointment.additionalPrepayment ?? false,
      exceptionReason: appointment.exceptionReason ?? "",
      exceptionConfirmedBy: appointment.exceptionConfirmedBy ?? "",
      exceptionMemo: appointment.memo ?? "",
    };
  }

  return {
    name: "",
    chartNumber: "",
    dateOfBirth: "",
    sex: "",
    careCategory: "검진",
    procedure: bookingOrigin === "SAME_DAY" ? "위" : "위·대장",
    procedureSet: "세트60",
    upperSedation: true,
    colonSedation: false,
    date: bookingOrigin === "SAME_DAY" ? seoulTodayIso() : "2026-08-01",
    start: bookingOrigin === "SAME_DAY" ? "09:00" : "10:30",
    bucket: "STANDARD_MORNING",
    bookingOrigin,
    sameDayReason: "",
    sameDayPreparationConfirmed: false,
    sameDayClinicianConfirmed: false,
    sameDayEscortConfirmed: false,
    screeningCopay: "없음",
    bowelPreparation: "원프렙",
    medicationsChecked: false,
    medicationListMemo: "",
    medicationDiscontinuations: [
      {
        id: "new-medication-1",
        medicationName: "",
        discontinuationDays: "",
        doctorConfirmed: false,
      },
    ],
    additionalExaminations: [],
    depositStatus: "UNSELECTED",
    depositPaymentMethod: "미확인",
    depositAmount: undefined,
    additionalPrepayment: false,
    exceptionReason: "",
    exceptionConfirmedBy: "",
    exceptionMemo: "",
  };
}

function validateBackendBookingDraft(draft: BookingDraft): ValidationResult {
  const duration = procedureDuration(draft.procedure, draft.procedureSet);
  const errors: string[] = [];
  if (!draft.name.trim() || !draft.chartNumber.trim() || !draft.dateOfBirth || !draft.sex) {
    errors.push("환자 이름·차트번호·생년월일·성별을 모두 확인해 주세요.");
  } else if (!isValidBirthDate(draft.dateOfBirth, draft.date)) {
    errors.push("생년월일을 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.");
  }
  if (draft.bucket === "AFTERNOON_EXCEPTION" && !draft.exceptionReason.trim()) {
    errors.push("14:00 오후 예외 예약에는 사유가 필요합니다.");
  }
  if (draft.bookingOrigin === "SAME_DAY") {
    if (draft.date !== seoulTodayIso()) {
      errors.push("당일 위내시경은 오늘 날짜로만 등록할 수 있습니다.");
    }
    if (draft.procedure !== "위") {
      errors.push("당일 추가 검사는 위내시경만 등록할 수 있습니다.");
    }
    if (!draft.sameDayReason.trim()) {
      errors.push("당일 위내시경 요청 사유를 입력해 주세요.");
    }
    if (!draft.sameDayPreparationConfirmed || !draft.sameDayClinicianConfirmed) {
      errors.push("검사 준비와 의료진 시행 가능 확인이 필요합니다.");
    }
    if (draft.upperSedation && !draft.sameDayEscortConfirmed) {
      errors.push("수면 위내시경은 귀가 동행 확인이 필요합니다.");
    }
    if (draft.bucket === "SAME_DAY_EXTENSION" && !draft.additionalSlotId) {
      errors.push("승인된 30분 연장 슬롯을 선택해 주세요.");
    }
  }
  return {
    valid: errors.length === 0,
    duration,
    end: fromMinutes(toMinutes(draft.start) + duration),
    errors,
    alternatives: [],
  };
}

const BOOKING_CALENDAR_WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
const BOOKING_WINDOW_END = addCalendarDays(addCalendarMonths(REFERENCE_TODAY, 4), -1);

function shortDateLabel(value: string): string {
  const date = parseIsoDate(value);
  return `${date.getMonth() + 1}/${date.getDate()}(${KOREAN_WEEKDAYS[date.getDay()]})`;
}

function bookingDayTitle(
  availability: ReturnType<typeof dayAvailability>,
  bucket: BookingDraft["bucket"],
): string {
  const label = koreanDateLabel(availability.date);
  if (availability.closed) return `${label} · 휴진`;
  const usage =
    bucket === "AFTERNOON_EXCEPTION"
      ? `14시 예외 ${availability.afternoonBooked ? 1 : 0}/1`
      : availability.shortMorning
        ? "단축 운영 09:00~11:00"
        : `위 ${availability.upperCount}/${MORNING_UPPER_CAPACITY} · 대장 ${availability.colonCount}/${MORNING_COLON_CAPACITY}`;
  const starts = availability.availableStarts.length
    ? `가능 ${availability.availableStarts.join(", ")}`
    : "가능 시간 없음";
  return `${label} · ${usage} · ${starts}`;
}

function BookingDatePicker({
  draft,
  appointments,
  excludeAppointmentId,
  onSelectDate,
}: {
  draft: BookingDraft;
  appointments: Appointment[];
  excludeAppointmentId?: string;
  onSelectDate: (date: string) => void;
}) {
  const [visibleMonth, setVisibleMonth] = useState(() =>
    addCalendarMonths(draft.date, 0),
  );
  const { year, month, days } = monthGridDays(visibleMonth);
  const availabilityFor = (date: string) =>
    dayAvailability(draft, appointments, date, excludeAppointmentId);
  const selected = availabilityFor(draft.date);

  const nextAvailable: ReturnType<typeof dayAvailability>[] = [];
  for (
    let date =
      draft.date >= REFERENCE_TODAY ? addCalendarDays(draft.date, 1) : REFERENCE_TODAY;
    date <= BOOKING_WINDOW_END && nextAvailable.length < 3;
    date = addCalendarDays(date, 1)
  ) {
    const availability = availabilityFor(date);
    if (availability.availableStarts.length > 0) nextAvailable.push(availability);
  }

  const selectDate = (date: string) => {
    setVisibleMonth(addCalendarMonths(date, 0));
    onSelectDate(date);
  };

  return (
    <div className="booking-calendar">
      <div className="booking-calendar__header">
        <button
          type="button"
          className="booking-calendar__nav"
          aria-label="이전 달"
          disabled={visibleMonth <= addCalendarMonths(REFERENCE_TODAY, 0)}
          onClick={() => setVisibleMonth(addCalendarMonths(visibleMonth, -1))}
        >
          ‹
        </button>
        <strong>
          {year}년 {month + 1}월
        </strong>
        <button
          type="button"
          className="booking-calendar__nav"
          aria-label="다음 달"
          disabled={visibleMonth >= addCalendarMonths(BOOKING_WINDOW_END, 0)}
          onClick={() => setVisibleMonth(addCalendarMonths(visibleMonth, 1))}
        >
          ›
        </button>
        <span>선택: {koreanDateLabel(draft.date)}</span>
      </div>
      <div className="booking-calendar__grid">
        {BOOKING_CALENDAR_WEEKDAYS.map((weekday) => (
          <div className="booking-calendar__weekday" key={weekday}>
            {weekday}
          </div>
        ))}
        {days.map((day) => {
          if (!day.currentMonth) {
            return (
              <span
                className="booking-calendar__cell is-outside"
                aria-hidden="true"
                key={day.iso}
              />
            );
          }
          const availability = availabilityFor(day.iso);
          const isSelected = day.iso === draft.date;
          const outOfWindow = day.iso < REFERENCE_TODAY || day.iso > BOOKING_WINDOW_END;
          const count = availability.availableStarts.length;
          const state = availability.closed
            ? "is-closed"
            : outOfWindow
              ? "is-past"
              : count > 0
                ? "is-available"
                : "is-full";
          const label = availability.closed
            ? "휴진"
            : outOfWindow
              ? ""
              : count > 0
                ? `가능 ${count}`
                : "마감";
          return (
            <button
              type="button"
              className={`booking-calendar__cell ${state} ${isSelected ? "is-selected" : ""}`}
              disabled={(availability.closed || outOfWindow) && !isSelected}
              aria-pressed={isSelected}
              aria-label={`${koreanDateLabel(day.iso)} ${label}`}
              title={bookingDayTitle(availability, draft.bucket)}
              onClick={() => selectDate(day.iso)}
              key={day.iso}
            >
              <span>{day.day}</span>
              {label && <small>{label}</small>}
              {availability.shortMorning &&
                !outOfWindow &&
                draft.bucket === "STANDARD_MORNING" && <em>단축</em>}
            </button>
          );
        })}
      </div>
      {selected.availableStarts.length === 0 && (
        <p className="booking-calendar__notice" role="status">
          {selected.closed
            ? "선택한 날짜는 휴진일입니다."
            : "선택한 날짜에는 현재 검사 조건으로 예약 가능한 시간이 없습니다."}{" "}
          아래 다음 가능일을 선택해 주세요.
        </p>
      )}
      <div className="booking-calendar__quick">
        <span>다음 가능일</span>
        {nextAvailable.length > 0 ? (
          nextAvailable.map((item) => (
            <button type="button" onClick={() => selectDate(item.date)} key={item.date}>
              {shortDateLabel(item.date)} · {item.availableStarts.length}개
            </button>
          ))
        ) : (
          <span>{shortDateLabel(BOOKING_WINDOW_END)}까지 가능한 날짜가 없습니다.</span>
        )}
      </div>
    </div>
  );
}

function BookingWizard({
  appointment,
  appointments,
  sameDay = false,
  canApproveExtension,
  onCreateAdditionalSlot,
  onClose,
  onSave,
}: {
  appointment?: Appointment;
  appointments: Appointment[];
  sameDay?: boolean;
  canApproveExtension: boolean;
  onCreateAdditionalSlot: (
    serviceDate: string,
    startTime: string,
    reason: string,
  ) => Promise<{ id: string; start_time: string }>;
  onClose: () => void;
  onSave: (draft: BookingDraft, validation: ValidationResult) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<BookingDraft>(() =>
    draftFromAppointment(appointment, sameDay ? "SAME_DAY" : "ADVANCE"),
  );
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [availability, setAvailability] =
    useState<ScheduleAvailabilityResponse | null>(null);
  const [availabilityError, setAvailabilityError] = useState("");
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const [extensionStart, setExtensionStart] = useState(
    isShortMorning(draft.date) ? "11:00" : "12:00",
  );
  const [extensionReason, setExtensionReason] = useState("");
  const [extensionPending, setExtensionPending] = useState(false);
  const [extensionError, setExtensionError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const birthDatePickerRef = useRef<HTMLInputElement>(null);

  const validation = useMemo(
    () =>
      appointment
        ? validateBooking(draft, appointments, appointment.id)
        : validateBackendBookingDraft(draft),
    [draft, appointments, appointment?.id],
  );
  const birthDateValid = isValidBirthDate(draft.dateOfBirth, draft.date);
  const identityComplete = Boolean(
    draft.name.trim() &&
      draft.chartNumber.trim() &&
      birthDateValid &&
      draft.sex,
  );
  const age = birthDateValid
    ? calculateAge(draft.dateOfBirth, draft.date, draft.careCategory)
    : null;

  const patchDraft = <Key extends keyof BookingDraft>(
    key: Key,
    value: BookingDraft[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const updateMedicationDiscontinuation = <
    Key extends keyof BookingDraft["medicationDiscontinuations"][number],
  >(
    id: string,
    key: Key,
    value: BookingDraft["medicationDiscontinuations"][number][Key],
  ) => {
    patchDraft(
      "medicationDiscontinuations",
      draft.medicationDiscontinuations.map((medication) =>
        medication.id === id ? { ...medication, [key]: value } : medication,
      ),
    );
  };

  const addMedicationDiscontinuation = () => {
    patchDraft("medicationDiscontinuations", [
      ...draft.medicationDiscontinuations,
      {
        id: `medication-${Date.now()}`,
        medicationName: "",
        discontinuationDays: "",
        doctorConfirmed: false,
      },
    ]);
  };

  const removeMedicationDiscontinuation = (id: string) => {
    const remaining = draft.medicationDiscontinuations.filter(
      (medication) => medication.id !== id,
    );
    patchDraft(
      "medicationDiscontinuations",
      remaining.length
        ? remaining
        : [
            {
              id: `medication-${Date.now()}`,
              medicationName: "",
              discontinuationDays: "",
              doctorConfirmed: false,
            },
          ],
    );
  };

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

  useEffect(() => {
    if (appointment) return;
    let cancelled = false;
    setAvailabilityLoading(true);
    setAvailabilityError("");
    setAvailability(null);
    void appointmentsApi
      .availability(draft)
      .then((response) => {
        if (cancelled) return;
        setAvailability(response);
        const starts = response.slots.map((slot) => slot.start_time.slice(0, 5));
        if (starts.length > 0 && !starts.includes(draft.start)) {
          setDraft((current) => ({
            ...current,
            start: starts[0],
            additionalSlotId: response.slots[0].additional_slot_id ?? undefined,
          }));
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAvailabilityError(
          error instanceof ApiError
            ? error.message
            : "가능 시간을 조회하지 못했습니다.",
        );
      })
      .finally(() => {
        if (!cancelled) setAvailabilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    appointment,
    draft.date,
    draft.procedure,
    draft.procedureSet,
    draft.upperSedation,
    draft.colonSedation,
    draft.bucket,
    draft.bookingOrigin,
    draft.additionalSlotId,
    availabilityRevision,
  ]);

  const slotStarts =
    appointment
      ? draft.bucket === "AFTERNOON_EXCEPTION"
        ? ["14:00"]
        : standardStartsFor(draft.date)
      : availability?.slots.map((slot) => slot.start_time.slice(0, 5)) ?? [];
  const selectedStartAvailable = Boolean(
    appointment || slotStarts.includes(draft.start),
  );

  const submitBooking = async () => {
    setSaveAttempted(true);
    setSaveError("");
    if (!validation.valid || !selectedStartAvailable || availabilityLoading) return;
    setSavePending(true);
    try {
      await onSave(draft, validation);
    } catch (error) {
      setSaveError(bookingCreateErrorMessage(error));
      if (error instanceof ApiError && error.status === 409) {
        setAvailabilityRevision((current) => current + 1);
      }
    } finally {
      setSavePending(false);
    }
  };

  const approveExtension = async () => {
    setExtensionError("");
    if (!extensionReason.trim()) {
      setExtensionError("연장 슬롯 승인 사유를 입력해 주세요.");
      return;
    }
    setExtensionPending(true);
    try {
      const slot = await onCreateAdditionalSlot(
        draft.date,
        extensionStart,
        extensionReason,
      );
      setDraft((current) => ({
        ...current,
        bucket: "SAME_DAY_EXTENSION",
        start: slot.start_time.slice(0, 5),
        additionalSlotId: slot.id,
      }));
      setAvailabilityRevision((current) => current + 1);
    } catch (error) {
      setExtensionError(
        error instanceof Error ? error.message : "연장 슬롯을 개설하지 못했습니다.",
      );
    } finally {
      setExtensionPending(false);
    }
  };

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
                placeholder="이름 입력"
                required
              />
            </label>
            <label className="field">
              <span>차트번호</span>
              <input
                value={draft.chartNumber}
                onChange={(event) => patchDraft("chartNumber", event.target.value)}
                placeholder="차트번호 입력"
                required
              />
            </label>
            <label className="field">
              <span>생년월일</span>
              <div className="birth-date-input">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="bday"
                  maxLength={10}
                  value={draft.dateOfBirth}
                  placeholder="YYYYMMDD"
                  aria-invalid={Boolean(draft.dateOfBirth) && !birthDateValid}
                  onChange={(event) =>
                    patchDraft(
                      "dateOfBirth",
                      formatBirthDateInput(event.target.value),
                    )
                  }
                  required
                />
                <button
                  type="button"
                  className="birth-date-calendar-button"
                  aria-label="달력으로 생년월일 선택"
                  onClick={() => birthDatePickerRef.current?.showPicker()}
                >
                  <Icon name="month" />
                </button>
                <input
                  ref={birthDatePickerRef}
                  className="birth-date-native-picker"
                  type="date"
                  min="1900-01-01"
                  max={draft.date}
                  value={birthDateValid ? draft.dateOfBirth : ""}
                  aria-label="생년월일 달력"
                  tabIndex={-1}
                  onChange={(event) =>
                    patchDraft("dateOfBirth", event.target.value)
                  }
                />
              </div>
              <small className={draft.dateOfBirth && !birthDateValid ? "field-error" : ""}>
                {draft.dateOfBirth && !birthDateValid
                  ? "실제 생년월일 8자리를 확인해 주세요."
                  : "숫자 8자리로 입력하면 YYYY-MM-DD 형식으로 자동 구분됩니다."}
              </small>
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
          {identityComplete ? (
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
          ) : (
            <div className="identity-confirmation identity-confirmation--empty">
              <Icon name="info" />
              <div>
                <strong>신규 환자 정보를 입력해 주세요.</strong>
                <span>네 항목을 모두 입력하면 다음 단계가 열립니다.</span>
              </div>
            </div>
          )}
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
          {draft.bookingOrigin === "SAME_DAY" && (
            <div className="same-day-banner" role="note">
              <Icon name="today" />
              <div>
                <strong>당일 위내시경 · 30분 전용</strong>
                <span>대장 및 동시검사는 등록할 수 없으며 오늘 일정만 조회합니다.</span>
              </div>
            </div>
          )}
          <label className="field">
            <span>검사 종류</span>
            <div className="choice-cards choice-cards--three">
              {(["위", "대장", "위·대장"] as const).map((procedure) => (
                <button
                  type="button"
                  disabled={draft.bookingOrigin === "SAME_DAY" && procedure !== "위"}
                  className={draft.procedure === procedure ? "is-active" : ""}
                  onClick={() => patchDraft("procedure", procedure)}
                  key={procedure}
                >
                  <strong>{procedure}</strong>
                  <small>
                    {procedure === "위·대장"
                      ? `${draft.procedureSet} · ${procedureDuration(procedure, draft.procedureSet)}분`
                      : `${procedureDuration(procedure)}분 점유`}
                  </small>
                </button>
              ))}
            </div>
          </label>
          {draft.procedure === "위·대장" && (
            <fieldset className="field procedure-set-field">
              <legend>진행담당</legend>
              <div className="segmented-control">
                {(["세트60", "세트90"] as const).map((procedureSet) => (
                  <button
                    type="button"
                    className={draft.procedureSet === procedureSet ? "is-active" : ""}
                    onClick={() => patchDraft("procedureSet", procedureSet)}
                    key={procedureSet}
                  >
                    {procedureSet} · {procedureSet === "세트60" ? "60분" : "90분"}
                  </button>
                ))}
              </div>
              <small>사람 이름 대신 실제 점유시간 기준으로 선택합니다.</small>
            </fieldset>
          )}
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
          {draft.bookingOrigin !== "SAME_DAY" && <fieldset className="field">
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
          </fieldset>}
          {draft.bookingOrigin !== "SAME_DAY" ? <fieldset className="field">
            <legend>검사 예정일</legend>
            <BookingDatePicker
              draft={draft}
              appointments={appointments}
              excludeAppointmentId={appointment?.id}
              onSelectDate={(date) =>
                setDraft((current) => {
                  const { availableStarts } = dayAvailability(
                    current,
                    appointments,
                    date,
                    appointment?.id,
                  );
                  const start =
                    availableStarts.length === 0 ||
                    availableStarts.includes(current.start)
                      ? current.start
                      : availableStarts[0];
                  return { ...current, date, start };
                })
              }
            />
          </fieldset> : (
            <div className="same-day-date-lock">
              <Icon name="lock" />
              <span><strong>검사일</strong>{draft.date} · 서울 기준 오늘</span>
            </div>
          )}
          <fieldset className="field">
            <legend>예약 시간</legend>
            {!appointment && availabilityLoading && (
              <p className="booking-calendar__notice" role="status">
                Backend에서 가능 시간을 확인하는 중입니다.
              </p>
            )}
            {!appointment && availabilityError && (
              <p className="booking-calendar__notice is-error" role="alert">
                {availabilityError}
              </p>
            )}
            <div className="slot-picker">
              {slotStarts.map((start) => {
                const slotValidation = validateSchedule(
                  { ...draft, start },
                  appointments,
                  appointment?.id,
                );
                return (
                  <button
                    type="button"
                    className={`${draft.start === start ? "is-selected" : ""} ${
                      appointment && !slotValidation.valid
                        ? "is-unavailable"
                        : "is-available"
                    }`}
                    onClick={() => {
                      const selectedSlot = availability?.slots.find(
                        (slot) => slot.start_time.slice(0, 5) === start,
                      );
                      setDraft((current) => ({
                        ...current,
                        start,
                        additionalSlotId:
                          selectedSlot?.additional_slot_id ?? undefined,
                      }));
                    }}
                    key={start}
                    title={
                      !appointment || slotValidation.valid
                        ? "Backend 조회 기준 예약 가능"
                        : slotValidation.errors.join(" ")
                    }
                  >
                    <strong>{start}</strong>
                    <small>{!appointment || slotValidation.valid ? "가능" : "불가"}</small>
                  </button>
                );
              })}
            </div>
          </fieldset>
          {draft.bookingOrigin === "SAME_DAY" && slotStarts.length === 0 && (
            <div className="same-day-extension-panel">
              <div className="exception-form__title">
                <Icon name="warning" />
                <div>
                  <strong>사용 가능한 일반 30분 슬롯이 없습니다.</strong>
                  <span>승인된 연장 슬롯을 조회하거나 관리자가 새 슬롯을 개설합니다.</span>
                </div>
              </div>
              {draft.bucket === "STANDARD_MORNING" && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      bucket: "SAME_DAY_EXTENSION",
                      additionalSlotId: undefined,
                    }))
                  }
                >
                  승인된 연장 슬롯 조회
                </button>
              )}
              {canApproveExtension && (
                <div className="form-grid form-grid--two">
                  <label className="field">
                    <span>연장 시작시각</span>
                    <select
                      value={extensionStart}
                      onChange={(event) => setExtensionStart(event.target.value)}
                    >
                      {(isShortMorning(draft.date)
                        ? ["11:00", "11:30", "12:00", "12:30", "13:00", "13:30"]
                        : ["12:00", "12:30", "13:00", "13:30"]
                      ).map((value) => <option key={value}>{value}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>관리자 승인 사유</span>
                    <input
                      value={extensionReason}
                      onChange={(event) => setExtensionReason(event.target.value)}
                      placeholder="예: 당일 진료 후 시행 승인"
                    />
                  </label>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={extensionPending}
                    onClick={() => void approveExtension()}
                  >
                    {extensionPending ? "승인 중…" : "30분 연장 슬롯 승인 및 열기"}
                  </button>
                </div>
              )}
              {extensionError && <p className="field-error" role="alert">{extensionError}</p>}
            </div>
          )}
          {draft.bookingOrigin === "SAME_DAY" && (
            <div className="same-day-readiness">
              <label className="field">
                <span>당일 요청 사유</span>
                <input
                  value={draft.sameDayReason}
                  onChange={(event) => patchDraft("sameDayReason", event.target.value)}
                  placeholder="예: 당일 진료 후 의료진 검사 결정"
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.sameDayPreparationConfirmed}
                  onChange={(event) =>
                    patchDraft("sameDayPreparationConfirmed", event.target.checked)
                  }
                />
                <span><strong>검사 준비 확인</strong><small>원내 정책에 따른 준비 항목을 사람이 확인했습니다.</small></span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.sameDayClinicianConfirmed}
                  onChange={(event) =>
                    patchDraft("sameDayClinicianConfirmed", event.target.checked)
                  }
                />
                <span><strong>의료진 시행 가능 확인</strong><small>시스템 판단이 아닌 의료진 결정을 기록합니다.</small></span>
              </label>
              {draft.upperSedation && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={draft.sameDayEscortConfirmed}
                    onChange={(event) =>
                      patchDraft("sameDayEscortConfirmed", event.target.checked)
                    }
                  />
                  <span><strong>귀가 동행 확인</strong><small>수면 위내시경일 때 필수입니다.</small></span>
                </label>
              )}
            </div>
          )}
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
              {age === null
                ? "생년월일 입력 필요"
                : draft.careCategory === "검진"
                  ? age
                  : `만 ${age}`} · {draft.sex || "성별 선택 필요"}
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
      const enteredMedications = draft.medicationDiscontinuations.filter(
        (medication) =>
          medication.medicationName.trim() ||
          medication.discontinuationDays.trim() ||
          medication.doctorConfirmed,
      );
      const confirmedMedicationCount = enteredMedications.filter(
        (medication) => medication.doctorConfirmed,
      ).length;
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
              <small>환자 진술과 확인 자료를 대조한 뒤 완료로 표시합니다.</small>
            </span>
          </label>
          <label className="field medication-list-memo">
            <span>전체 복용약 목록 메모</span>
            <textarea
              rows={3}
              value={draft.medicationListMemo}
              placeholder="예: 합성약 A 1정 아침, 합성약 B 1정 저녁 · 복용약 없음은 ‘없음’으로 기록"
              onChange={(event) =>
                patchDraft("medicationListMemo", event.target.value)
              }
            />
            <small>약품명·용량·복용 횟수를 확인된 내용 그대로 기록합니다.</small>
          </label>
          <div className="medication-decision">
            <div className="medication-decision__heading">
              <div>
                <strong>특정 복용약 중단 결정 기록</strong>
                <span>
                  시스템 권고가 아닌 담당 의사가 결정한 실제 중단 일수만
                  입력합니다.
                </span>
              </div>
              <button
                type="button"
                className="secondary-button medication-add-button"
                onClick={addMedicationDiscontinuation}
              >
                <Icon name="add" />
                약품 추가
              </button>
            </div>
            <div className="medication-decision-list">
              {draft.medicationDiscontinuations.map((medication, index) => (
                <div className="medication-decision-row" key={medication.id}>
                  <div className="medication-decision-row__heading">
                    <strong>중단 검토 약 {index + 1}</strong>
                    <button
                      type="button"
                      className="text-button text-button--danger"
                      onClick={() => removeMedicationDiscontinuation(medication.id)}
                    >
                      삭제
                    </button>
                  </div>
                  <div className="medication-decision-fields">
                    <label className="field">
                      <span>약품명</span>
                      <input
                        value={medication.medicationName}
                        placeholder="예: 합성약 A"
                        onChange={(event) =>
                          updateMedicationDiscontinuation(
                            medication.id,
                            "medicationName",
                            event.target.value,
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span>의사가 결정한 실제 중단 일수</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={medication.discontinuationDays}
                        placeholder="예: 5"
                        onChange={(event) =>
                          updateMedicationDiscontinuation(
                            medication.id,
                            "discontinuationDays",
                            event.target.value,
                          )
                        }
                      />
                    </label>
                    <label className="switch-row medication-confirmation">
                      <input
                        type="checkbox"
                        checked={medication.doctorConfirmed}
                        onChange={(event) =>
                          updateMedicationDiscontinuation(
                            medication.id,
                            "doctorConfirmed",
                            event.target.checked,
                          )
                        }
                      />
                      <span>담당 의사 확인</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <small className="field-note">
              빈 행은 중단 결정 없음으로 처리합니다. 입력한 각 약품은 약품명·일수와
              담당 의사 확인이 모두 필요합니다.
            </small>
          </div>
          <div className="medication-summary-grid">
            <div className={draft.medicationsChecked ? "is-complete" : "is-warning"}>
              <span>전체 목록 확인</span>
              <strong>{draft.medicationsChecked ? "완료" : "대기"}</strong>
            </div>
            <div>
              <span>중단 검토 약</span>
              <strong>{enteredMedications.length}개</strong>
            </div>
            <div
              className={
                enteredMedications.length === confirmedMedicationCount
                  ? "is-complete"
                  : "is-warning"
              }
            >
              <span>담당 의사 확인</span>
              <strong>
                {confirmedMedicationCount}/{enteredMedications.length}
              </strong>
            </div>
          </div>
        </div>
      );
    }

    if (step === 6) {
      const options = [
        "lab",
        "CLO",
        "복부초음파",
        "갑상선초음파",
        "심장초음파",
        "경동맥초음파",
      ];
      return (
        <div className="form-section">
          <div className="form-section__heading">
            <span className="step-number">6</span>
            <div>
              <h3>추가 검사</h3>
              <p>동일 내원일에 함께 안내할 추가 검사를 선택합니다.</p>
            </div>
          </div>
          <div className="choice-cards choice-cards--three">
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
      const depositPaid = draft.depositStatus === "PAID";
      const depositUnpaid = draft.depositStatus === "UNPAID";
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
              <select aria-label="예약금액" value={draft.depositAmount ?? ""}
                onChange={(event) => patchDraft("depositAmount", event.target.value ? Number(event.target.value) as Appointment["depositAmount"] : undefined)}>
                <option value="">금액 미확인</option>
                {[10000, 20000, 30000].map((amount) => <option key={amount} value={amount}>{amount.toLocaleString("ko-KR")}원</option>)}
              </select>
            </div>
            <fieldset className="deposit-status-choice">
              <legend>수납 상태</legend>
              <label className={depositPaid ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="deposit-status"
                  checked={depositPaid}
                  onChange={() => patchDraft("depositStatus", "PAID")}
                />
                <span>
                  <strong>납부 완료</strong>
                  <small>금액과 수납 방법을 함께 기록합니다.</small>
                </span>
              </label>
              <label className={depositUnpaid ? "is-selected is-unpaid" : ""}>
                <input
                  type="radio"
                  name="deposit-status"
                  checked={depositUnpaid}
                  onChange={() =>
                    setDraft((current) => ({
                      ...current,
                      depositStatus: "UNPAID",
                      depositPaymentMethod: "미확인",
                      additionalPrepayment: false,
                    }))
                  }
                />
                <span>
                  <strong>미납으로 예약</strong>
                  <small>미납 상태를 확인하고 예약을 진행합니다.</small>
                </span>
              </label>
            </fieldset>
          </div>
          <div
            className={`deposit-options ${
              depositPaid ? "" : "is-disabled"
            }`}
          >
            <div className="deposit-method">
              <span>예약금 수납 방법</span>
              <div
                className="segmented-control"
                role="group"
                aria-label="예약금 수납 방법"
              >
                {(["현금", "카드"] as const).map((method) => (
                  <button
                    type="button"
                    disabled={!depositPaid}
                    className={
                      draft.depositPaymentMethod === method ? "is-active" : ""
                    }
                    onClick={() =>
                      patchDraft("depositPaymentMethod", method)
                    }
                    key={method}
                  >
                    {method} 수납
                  </button>
                ))}
              </div>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                disabled={!depositPaid}
                checked={draft.additionalPrepayment}
                onChange={(event) =>
                  patchDraft("additionalPrepayment", event.target.checked)
                }
              />
              <span>
                <strong>추가 선납금 있음</strong>
                <small>기본 예약금 외 추가 선납금 여부를 기록합니다.</small>
              </span>
            </label>
          </div>
          <div className="check-card-grid">
            <CheckCard label="취소·환불 규정 고지" checked />
            <CheckCard label="환자 동의" checked />
            <CheckCard
              label={
                depositPaid
                  ? `${draft.depositPaymentMethod} 수납 기록`
                  : depositUnpaid
                    ? "미납 예약 확인"
                    : "수납 상태 확인"
              }
              checked={depositPaid || depositUnpaid}
            />
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
              {age === null
                ? "생년월일 입력 필요"
                : draft.careCategory === "검진"
                  ? age
                  : `만 ${age}`} · {draft.sex || "성별 선택 필요"}
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
                : draft.bucket === "SAME_DAY_EXTENSION"
                  ? "당일 연장 슬롯"
                  : draft.bookingOrigin === "SAME_DAY"
                    ? "당일 일반 빈 슬롯"
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
              약제 {draft.medicationsChecked ? "확인" : "미완료"}
              {draft.medicationDiscontinuations.some((item) =>
                item.medicationName.trim(),
              )
                ? ` · 중단 검토 ${draft.medicationDiscontinuations.filter((item) => item.medicationName.trim()).length}개`
                : ""}{" "}
              · 예약금{" "}
              {draft.depositStatus === "PAID"
                ? `${draft.depositPaymentMethod} 완료`
                : draft.depositStatus === "UNPAID"
                  ? "미납 확인"
                  : "상태 미확인"}
              {draft.additionalPrepayment ? " · 추가 선납금 있음" : ""}
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
                ? appointment
                  ? "현재 합성 일정 Snapshot 기준으로 충돌이 없습니다."
                  : "Backend 가능 슬롯 조회 기준으로 저장할 수 있습니다."
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
              {appointment
                ? "예약 변경"
                : draft.bookingOrigin === "SAME_DAY"
                  ? "당일 위내시경"
                  : "신규 예약"}
            </span>
            <h2 id="booking-modal-title">
              {appointment
                ? `${appointment.name} 예약 변경`
                : draft.bookingOrigin === "SAME_DAY"
                  ? "당일 위내시경 빠른 등록"
                  : "예약 등록"}
            </h2>
          </div>
          <span className="data-chip">
            {appointment
              ? "합성 데이터"
              : draft.bookingOrigin === "SAME_DAY"
                ? "위 30분"
                : "신규 입력"}
          </span>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </header>

        {!appointment && (
          <div className="prototype-boundary" role="note">
            <Icon name="info" />
            <span>
              <strong>Backend 저장 범위</strong>
              환자 식별·검사·일정·예약 구분{draft.bookingOrigin === "SAME_DAY" ? "·당일 확인" : ""}을 저장합니다. 검진 정보, 장정결제,
              복용약, 추가 검사, 예약금과 확인 상태는 아직 정적 Prototype입니다.
            </span>
          </div>
        )}

        <div className="booking-modal__body">
          <nav className="wizard-nav" aria-label="예약 등록 단계">
            {WIZARD_STEPS.map((label, index) => {
              const stepNumber = index + 1;
              return (
                <button
                  className={`${step === stepNumber ? "is-active" : ""} ${
                    stepNumber < step ? "is-complete" : ""
                  }`}
                  disabled={
                    (!identityComplete && stepNumber > 1) ||
                    (stepNumber > 7 && draft.depositStatus === "UNSELECTED")
                  }
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
                    : draft.bucket === "SAME_DAY_EXTENSION"
                      ? "승인 슬롯 1건"
                    : isShortMorning(draft.date)
                      ? "4 Slot 기반"
                      : "위 5 · 대장 3"}
                </dd>
              </div>
            </dl>
            {saveAttempted && (!validation.valid || !selectedStartAvailable) && (
              <div className="save-error" role="alert">
                {validation.errors[0] ??
                  availabilityError ??
                  "Backend에서 확인된 가능 시간을 선택해 주세요."}
              </div>
            )}
            {saveError && (
              <div className="save-error" role="alert">
                {saveError}
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
                disabled={
                  (step === 1 && !identityComplete) ||
                  (step === 7 && draft.depositStatus === "UNSELECTED")
                }
                onClick={() => setStep((current) => Math.min(8, current + 1))}
              >
                다음
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={savePending || availabilityLoading}
                onClick={() => void submitBooking()}
              >
                <Icon name="check" />
                {savePending
                  ? "저장 중…"
                  : appointment
                    ? "변경 저장"
                    : "예약 저장"}
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

function AppointmentDetailDialog({
  appointment,
  onClose,
  onEdit,
  onVerify,
  onCorrectVerification,
  onUpdate,
  canEdit,
  canVerify,
}: {
  appointment: Appointment;
  onClose: () => void;
  onEdit: () => void;
  onVerify: () => void;
  onCorrectVerification: (reason: string) => void;
  onUpdate: (patch: Partial<Appointment>) => void;
  canEdit: boolean;
  canVerify: boolean;
}) {
  const [tab, setTab] = useState("업무 요약");
  const [correctingVerification, setCorrectingVerification] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionError, setCorrectionError] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);
  const tabs = [
    "업무 요약",
    "환자·검사",
    "준비·약제",
    "결제",
    "이력·결과",
  ];
  const checkItems = [
    { label: "약제확인", icon: "medication", state: appointment.medication },
    { label: "D-1 확인", icon: "phone", state: appointment.d1 },
    { label: "이중확인", icon: "shield", state: appointment.verification },
    { label: "예약금", icon: "deposit", state: appointment.deposit },
  ];
  const pendingItems = checkItems.filter((item) => item.state === "대기");
  const medicationDiscontinuations =
    appointment.medicationDiscontinuations ??
    (appointment.medicationDiscontinuationName &&
    appointment.medicationDiscontinuationDays !== undefined
      ? [
          {
            medicationName: appointment.medicationDiscontinuationName,
            discontinuationDays: appointment.medicationDiscontinuationDays,
            doctorConfirmed: appointment.medicationDoctorConfirmed ?? false,
          },
        ]
      : []);
  const medicationConfirmationCount = medicationDiscontinuations.filter(
    (medication) => medication.doctorConfirmed,
  ).length;

  return (
    <div className="appointment-detail-backdrop" onMouseDown={onClose}>
      <section
        className="appointment-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled)");
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="appointment-detail__header">
          <div className="appointment-detail__identity">
            <span className="avatar">{appointment.name.slice(0, 1)}</span>
            <div>
              <span className="eyebrow">환자 상세 · 합성 데이터</span>
              <h2 id="appointment-detail-title">{appointment.name}</h2>
              <p>
                {appointment.chartNumber} · {formatAgeSex(appointment)}
              </p>
            </div>
          </div>
          <div className="appointment-detail__schedule">
            <span>{formatDateKorean(appointment.date)}</span>
            <strong>
              {appointment.start} · {appointment.duration}분 · {procedureLabel(appointment)}
            </strong>
          </div>
          <button ref={closeButtonRef} className="icon-button" onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </header>
        <nav className="appointment-detail__tabs" aria-label="환자 상세 구분">
          {tabs.map((item) => (
            <button
              className={tab === item ? "is-active" : ""}
              aria-pressed={tab === item}
              onClick={() => setTab(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </nav>
        <div className="appointment-detail__content">
          {tab === "업무 요약" && (
            <div className="appointment-summary">
              <div
                className={`appointment-attention ${pendingItems.length === 0 ? "is-clear" : ""}`}
              >
                <Icon name={pendingItems.length === 0 ? "check" : "warning"} />
                <div>
                  <strong>
                    {pendingItems.length === 0
                      ? "필수 확인 업무가 완료되었습니다."
                      : `확인 대기 ${pendingItems.length}건`}
                  </strong>
                  <span>
                    {pendingItems.length === 0
                      ? "현재 추가 조치가 필요한 항목이 없습니다."
                      : pendingItems.map((item) => item.label).join(" · ")}
                  </span>
                </div>
              </div>

              <div className="appointment-check-grid" aria-label="핵심 확인 상태">
                {checkItems.map((item) => (
                  <div key={item.label}>
                    <span>
                      <Icon name={item.icon} />
                      {item.label}
                    </span>
                    <StateLabel state={item.state} />
                  </div>
                ))}
              </div>

              <div className="appointment-operation-grid">
                <section>
                  <span className="eyebrow">검사 핵심 정보</span>
                  <h3>예약 및 환자</h3>
                  <dl className="appointment-detail-list">
                    <div><dt>검사 일시</dt><dd>{appointment.date} {appointment.start}</dd></div>
                    <div><dt>검사 종류</dt><dd>{procedureLabel(appointment)}</dd></div>
                    <div><dt>생년월일</dt><dd>{appointment.dateOfBirth}</dd></div>
                    <div><dt>나이 · 성별</dt><dd>{formatAgeSex(appointment)}</dd></div>
                    <div><dt>일반검진</dt><dd>{appointment.generalScreening ?? "미확인"}</dd></div>
                    <div><dt>대장암검진</dt><dd>{appointment.colorectalScreening ?? "미확인"}{appointment.colorectalScreening === "실시" ? ` · ${appointment.colorectalScreeningResult ?? "미확인"}` : ""}</dd></div>
                  </dl>
                </section>
                <section>
                  <span className="eyebrow">준비 및 안내</span>
                  <h3>검사 전 확인</h3>
                  <dl className="appointment-detail-list">
                    <div><dt>장정결제</dt><dd>{appointment.bowelPreparation ?? "해당 없음"}</dd></div>
                    <div><dt>본인부담</dt><dd>{appointment.screeningCopay ?? "해당 없음"}</dd></div>
                    <div><dt>추가 검사</dt><dd>{appointment.additionalExaminations?.join(", ") ?? "선택 없음"}</dd></div>
                    <div><dt>메모</dt><dd>{appointment.memo ?? "기록 없음"}</dd></div>
                    {appointment.positiveScreeningColonoscopyMemo && <div><dt>양성 후 대장내시경</dt><dd>{appointment.positiveScreeningColonoscopyMemo}</dd></div>}
                  </dl>
                </section>
              </div>
            </div>
          )}

          {tab === "환자·검사" && (
            <section className="appointment-detail-section">
              <span className="eyebrow">환자·검사</span>
              <h3>예약과 환자 기본정보</h3>
              <dl className="appointment-detail-list appointment-detail-list--wide">
                <div><dt>차트번호</dt><dd>{appointment.chartNumber}</dd></div>
                <div><dt>생년월일</dt><dd>{appointment.dateOfBirth}</dd></div>
                <div><dt>나이 · 성별</dt><dd>{formatAgeSex(appointment)}</dd></div>
                <div><dt>진료 구분</dt><dd>{appointment.careCategory}</dd></div>
                <div><dt>검사 예정</dt><dd>{appointment.date} {appointment.start} · {appointment.duration}분</dd></div>
                <div><dt>검사 종류</dt><dd>{procedureLabel(appointment)}</dd></div>
                <div><dt>현재 상태</dt><dd>{appointment.status}</dd></div>
                <div><dt>오후 예외</dt><dd>{appointment.afternoonException ? appointment.exceptionReason ?? "승인 사유 확인" : "해당 없음"}</dd></div>
                <div><dt>당일 추가</dt><dd>{appointment.sameDay ? `${appointment.sameDayExtension ? "연장슬롯 · " : ""}${appointment.sameDayReason ?? "사유 확인"}` : "해당 없음"}</dd></div>
              </dl>
              <AppointmentOperationsEditor key={`${appointment.id}-screening`} appointment={appointment} mode="screening" canEdit={canEdit} onSave={onUpdate} />
            </section>
          )}

          {tab === "준비·약제" && (
            <section className="appointment-detail-section">
              <span className="eyebrow">준비·약제</span>
              <h3>검사 전 준비사항</h3>
              <dl className="appointment-detail-list appointment-detail-list--wide">
                <div><dt>장정결제</dt><dd>{appointment.bowelPreparation ?? "해당 없음"}</dd></div>
                <div><dt>위 수면</dt><dd>{appointment.upperSedation === undefined ? "해당 없음" : appointment.upperSedation ? "수면" : "비수면"}</dd></div>
                <div><dt>대장 수면</dt><dd>{appointment.colonSedation === undefined ? "해당 없음" : appointment.colonSedation ? "수면" : "비수면"}</dd></div>
                <div><dt>추가 검사</dt><dd>{appointment.additionalExaminations?.join(", ") ?? "선택 없음"}</dd></div>
                <div><dt>약제확인</dt><dd><StateLabel state={appointment.medication} /></dd></div>
                <div><dt>전체 복용약</dt><dd>{appointment.medicationListMemo || "기록 없음"}</dd></div>
                <div><dt>약제 중단 결정</dt><dd>{medicationDiscontinuations.length > 0 ? medicationDiscontinuations.map((medication) => `${medication.medicationName} · ${medication.discontinuationDays}일`).join(", ") : "기록 없음"}</dd></div>
                <div><dt>의사 확인</dt><dd>{medicationDiscontinuations.length > 0 ? `${medicationConfirmationCount}/${medicationDiscontinuations.length} 완료` : "기록 없음"}</dd></div>
                <div><dt>D-1 안내</dt><dd><StateLabel state={appointment.d1} /></dd></div>
              </dl>
            </section>
          )}

          {tab === "결제" && (
            <section className="appointment-detail-section">
              <span className="eyebrow">결제</span>
              <h3>수납 정보</h3>
              <dl className="appointment-detail-list appointment-detail-list--wide">
                <div><dt>예약금</dt><dd><StateLabel state={appointment.deposit} /></dd></div>
                <div><dt>수납 상태</dt><dd>{appointment.deposit === "완료" ? "납부 완료" : appointment.depositUnpaidConfirmed ? "미납 확인" : "확인 대기"}</dd></div>
                <div><dt>수납 방법</dt><dd>{appointment.deposit === "완료" ? appointment.depositPaymentMethod ?? "방법 확인 필요" : "해당 없음"}</dd></div>
                <div><dt>예약금액</dt><dd>{appointment.depositAmount ? `${appointment.depositAmount.toLocaleString("ko-KR")}원` : "금액 미확인"}</dd></div>
                <div><dt>추가 선납금</dt><dd>{appointment.additionalPrepayment ? "있음" : "없음"}</dd></div>
                <div><dt>검진 본인부담</dt><dd>{appointment.screeningCopay ?? "해당 없음"}</dd></div>
              </dl>
              <AppointmentOperationsEditor key={`${appointment.id}-payment`} appointment={appointment} mode="payment" canEdit={canEdit} onSave={onUpdate} />
            </section>
          )}

          {tab === "이력·결과" && (
            <section className="appointment-detail-section appointment-detail-section--empty">
              <Icon name="history" />
              <h3>이력과 결과는 예약과 분리해 누적합니다.</h3>
              <p>예약 변경 이력, 검사 결과, 조직검사 결과를 시간순으로 표시할 영역입니다.</p>
              <span>현재 Prototype에서는 합성 예약 정보만 표시합니다.</span>
            </section>
          )}

          <div className="appointment-audit-note">
            <Icon name="history" />
            <span>
              {appointment.verificationCorrectedAt
                ? `최근 2차 확인 정정: ${appointment.verificationCorrectedAt} · ${appointment.verificationCorrectionReason}`
                : "핵심정보 변경 시 기존 이중확인은 무효화되고 재확인이 필요합니다."}
            </span>
          </div>
          {correctingVerification && (
            <form className="verification-correction" onSubmit={(event) => {
              event.preventDefault();
              if (!correctionReason.trim()) {
                setCorrectionError("정정 사유를 입력해 주세요.");
                return;
              }
              onCorrectVerification(correctionReason.trim());
              setCorrectingVerification(false);
              setCorrectionReason("");
              setCorrectionError("");
            }}>
              <div>
                <strong>2차 확인 완료를 취소하시겠습니까?</strong>
                <span>상태가 ‘대기’로 돌아가며 정정 사유와 시각이 기록됩니다.</span>
              </div>
              <label>
                정정 사유
                <textarea autoFocus rows={2} maxLength={500} value={correctionReason}
                  onChange={(event) => { setCorrectionReason(event.target.value); setCorrectionError(""); }}
                  placeholder="예: 환자 선택을 잘못하여 완료 처리함" />
              </label>
              {correctionError && <p role="alert">{correctionError}</p>}
              <div>
                <button type="button" className="secondary-button" onClick={() => { setCorrectingVerification(false); setCorrectionError(""); }}>그대로 유지</button>
                <button type="submit" className="danger-button">완료 상태 취소</button>
              </div>
            </form>
          )}
        </div>
        <footer className="appointment-detail__footer">
          <button className="secondary-button" onClick={onClose}>
            닫기
          </button>
          {canEdit ? (
            <button className="secondary-button" onClick={onEdit}>
              <Icon name="edit" />
              예약 변경
            </button>
          ) : null}
          {canVerify && appointment.verification !== "완료" ? (
            <button className="primary-button" onClick={onVerify}>
              <Icon name="check" />
              2차 확인 완료
            </button>
          ) : null}
          {canVerify && appointment.verification === "완료" && !correctingVerification ? (
            <button className="secondary-button verification-correct-button" onClick={() => setCorrectingVerification(true)}>
              <Icon name="history" />
              2차 확인 정정
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function PathologyDrawer({
  pathologyCase,
  onClose,
  onUpdate,
  canWrite,
}: {
  pathologyCase: PathologyCase;
  onClose: () => void;
  onUpdate: (patch: Partial<PathologyCase>) => void;
  canWrite: boolean;
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
          {canWrite ? (
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
          ) : (
            <div className="permission-note">
              <Icon name="lock" />
              <span>조회 권한으로 열었습니다. 기록 변경은 허용되지 않습니다.</span>
            </div>
          )}
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

function Workbench({
  user,
  csrfToken,
  onLogout,
  logoutError,
}: {
  user: AuthUser;
  csrfToken: string | null;
  onLogout: () => Promise<boolean>;
  logoutError: string;
}) {
  const [activeView, setActiveView] = useState<ViewId>("week");
  const [calendarDate, setCalendarDate] = useState(REFERENCE_TODAY);
  const [statisticsPeriod, setStatisticsPeriod] =
    useState<StatisticsPeriod>("week");
  const [appointments, setAppointments] =
    useState<Appointment[]>(initialAppointments);
  const [backendAppointments, setBackendAppointments] = useState<Appointment[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleRevision, setScheduleRevision] = useState(0);
  const [pathologyCases, setPathologyCases] =
    useState<PathologyCase[]>(initialPathologyCases);
  const [selectedId, setSelectedId] = useState("APT-017");
  const [bookingModal, setBookingModal] = useState<{
    mode: "new" | "edit" | "same-day";
    appointmentId?: string;
  } | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const canCreateAppointment =
    hasAnyPermission(user, ["appointment.create"]) &&
    hasAnyPermission(user, ["patient.read"]);
  const canUpdateAppointment = hasAnyPermission(user, ["appointment.update"]);
  const canApproveExtension = hasAnyPermission(user, ["schedule_override.approve"]);
  const canVerifyIdentity = hasAnyPermission(user, [
    "verification.secondary",
  ]);
  const canWritePathology = hasAnyPermission(user, ["pathology.write"]);
  const visibleNavigation = useMemo(
    () =>
      NAVIGATION.filter((item) =>
        item.id === "booking"
          ? canCreateAppointment
          : hasAnyPermission(user, item.permissions),
      ),
    [canCreateAppointment, user],
  );

  const selectedAppointment =
    backendAppointments.find((appointment) => appointment.id === selectedId) ??
    appointments.find((appointment) => appointment.id === selectedId);
  const editingAppointment =
    bookingModal?.mode === "edit"
      ? [...backendAppointments, ...appointments].find(
          (appointment) => appointment.id === bookingModal.appointmentId,
        )
      : undefined;

  useEffect(() => {
    let cancelled = false;
    setScheduleLoading(true);
    setScheduleError("");
    setBackendAppointments([]);
    void Promise.all(calendarQueries(activeView, calendarDate).map(
      ({ startDate, endDate }) => appointmentsApi.list(startDate, endDate),
    ))
      .then((pages) => {
        if (!cancelled) setBackendAppointments(pages.flat());
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setBackendAppointments([]);
        setScheduleError(
          error instanceof ApiError
            ? error.message
            : "예약을 조회하지 못했습니다.",
        );
      })
      .finally(() => {
        if (!cancelled) setScheduleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeView, calendarDate, scheduleRevision]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const openAppointmentDetail = (appointmentId: string) => {
    setSelectedId(appointmentId);
    setDrawer({ kind: "appointment", id: appointmentId });
  };

  const openDay = (date: string) => {
    setCalendarDate(date);
    setActiveView("day");
    const firstAppointment = appointments
      .filter((appointment) => appointment.date === date)
      .sort((first, second) => first.start.localeCompare(second.start))[0];
    if (firstAppointment) setSelectedId(firstAppointment.id);
  };

  const moveCalendar = (direction: -1 | 1) => {
    if (activeView === "statistics") {
      setCalendarDate((current) =>
        statisticsPeriod === "year"
          ? addCalendarYears(current, direction)
          : statisticsPeriod === "month"
            ? addCalendarMonths(current, direction)
            : addCalendarDays(current, direction * 7),
      );
      return;
    }
    if (activeView === "month") {
      setCalendarDate((current) => addCalendarMonths(current, direction));
      return;
    }
    setCalendarDate((current) =>
      addCalendarDays(current, direction * (activeView === "week" ? 7 : 1)),
    );
  };

  const openNewBooking = () => {
    if (!canCreateAppointment) return;
    setDrawer(null);
    setBookingModal({ mode: "new" });
  };

  const openSameDayUpper = () => {
    if (!canCreateAppointment) return;
    setDrawer(null);
    setBookingModal({ mode: "same-day" });
  };

  const createSameDayExtension = async (
    serviceDate: string,
    startTime: string,
    reason: string,
  ) => {
    if (!csrfToken) {
      throw new Error("보안 세션이 없어 연장 슬롯을 승인할 수 없습니다.");
    }
    return appointmentsApi.createAdditionalSlot(
      serviceDate,
      startTime,
      reason,
      csrfToken,
    );
  };

  const openEditBooking = (appointmentId = selectedId) => {
    if (!canUpdateAppointment || !appointmentId) return;
    const target = backendAppointments.find((item) => item.id === appointmentId);
    if (target) {
      notify("Backend 예약 변경은 다음 연결 단계에서 제공합니다.");
      return;
    }
    setDrawer(null);
    setBookingModal({ mode: "edit", appointmentId });
  };

  const verifySelected = () => {
    if (!canVerifyIdentity || !selectedAppointment || selectedAppointment.backendManaged) return;
    setAppointments((current) =>
      current.map((appointment) =>
        appointment.id === selectedAppointment.id
          ? { ...appointment, verification: "완료" as const }
          : appointment,
      ),
    );
    notify(`${selectedAppointment.name}님의 2차 확인을 기록했습니다.`);
  };

  const correctSelectedVerification = (reason: string) => {
    if (!canVerifyIdentity || !selectedAppointment || selectedAppointment.backendManaged) return;
    const correctedAt = new Intl.DateTimeFormat("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(new Date());
    setAppointments((current) => current.map((appointment) =>
      appointment.id === selectedAppointment.id
        ? { ...appointment, verification: "대기" as const, verificationCorrectionReason: reason, verificationCorrectedAt: correctedAt }
        : appointment,
    ));
    notify(`${selectedAppointment.name}님의 2차 확인 완료를 정정했습니다.`);
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await onLogout();
    setLoggingOut(false);
  };

  const saveBooking = async (
    draft: BookingDraft,
    validation: ValidationResult,
  ): Promise<void> => {
    const patientSex = draft.sex;
    if (!patientSex) {
      notify("환자 성별을 선택해 주세요.");
      return;
    }
    if (!isDepositSelectionComplete(draft)) {
      notify(
        draft.depositStatus === "UNSELECTED"
          ? "예약금 납부 완료 또는 미납으로 예약 중 하나를 선택해 주세요."
          : "예약금 수납 완료 시 금액과 카드·현금 수납 방법을 선택해 주세요.",
      );
      return;
    }
    // 이 검사는 화면 노출 제어용입니다. 실제 권한은 Backend가 다시 검사해야 합니다.
    if (
      (bookingModal?.mode === "edit" && !canUpdateAppointment) ||
      (bookingModal?.mode === "new" && !canCreateAppointment)
    ) {
      notify("이 작업을 수행할 권한이 없습니다.");
      return;
    }
    const medicationDiscontinuations = draft.medicationDiscontinuations
      .filter(
        (medication) =>
          medication.medicationName.trim() &&
          medication.discontinuationDays.trim(),
      )
      .map((medication) => ({
        medicationName: medication.medicationName.trim(),
        discontinuationDays: Number(medication.discontinuationDays),
        doctorConfirmed: medication.doctorConfirmed,
      }));
    const firstMedicationDiscontinuation = medicationDiscontinuations[0];
    if (bookingModal?.mode === "edit" && editingAppointment) {
      const coreChanged =
        editingAppointment.date !== draft.date ||
        editingAppointment.start !== draft.start ||
        editingAppointment.procedure !== draft.procedure ||
        (draft.procedure === "위·대장" &&
          editingAppointment.procedureSet !== draft.procedureSet) ||
        editingAppointment.name !== draft.name ||
        editingAppointment.chartNumber !== draft.chartNumber ||
        editingAppointment.dateOfBirth !== draft.dateOfBirth ||
        editingAppointment.sex !== patientSex ||
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
                sex: patientSex,
                careCategory: draft.careCategory,
                procedure: draft.procedure,
                procedureSet:
                  draft.procedure === "위·대장" ? draft.procedureSet : undefined,
                upperSedation: draft.upperSedation,
                colonSedation: draft.colonSedation,
                date: draft.date,
                start: draft.start,
                duration: validation.duration,
                screeningCopay: draft.screeningCopay,
                bowelPreparation:
                  draft.procedure === "위" ? undefined : draft.bowelPreparation,
                medication: draft.medicationsChecked ? "완료" : "대기",
                medicationListMemo: draft.medicationListMemo.trim() || undefined,
                medicationDiscontinuations:
                  medicationDiscontinuations.length > 0
                    ? medicationDiscontinuations
                    : undefined,
                medicationDiscontinuationName:
                  firstMedicationDiscontinuation?.medicationName,
                medicationDiscontinuationDays:
                  firstMedicationDiscontinuation?.discontinuationDays,
                medicationDoctorConfirmed:
                  medicationDiscontinuations.length > 0
                    ? medicationDiscontinuations.every(
                        (medication) => medication.doctorConfirmed,
                      )
                    : undefined,
                additionalExaminations: draft.additionalExaminations,
                deposit: draft.depositStatus === "PAID" ? "완료" : "대기",
                depositUnpaidConfirmed:
                  draft.depositStatus === "UNPAID" || undefined,
                depositAmount: draft.depositAmount,
                depositPaymentMethod: draft.depositStatus === "PAID" && draft.depositPaymentMethod !== "미확인"
                  ? draft.depositPaymentMethod
                  : undefined,
                additionalPrepayment:
                  draft.depositStatus === "PAID" && draft.additionalPrepayment
                    ? true
                    : undefined,
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
      if (!csrfToken) {
        throw new ApiError(403, "보안 세션 정보가 없습니다. 다시 로그인해 주세요.");
      }
      const patient = await appointmentsApi.findExactPatient(draft);
      if (!patient) {
        throw new Error(
          "등록된 합성 환자와 이름·차트번호·생년월일·성별이 정확히 일치하지 않습니다. 합성 환자 Seed 정보를 확인해 주세요.",
        );
      }
      const response = await appointmentsApi.create(draft, patient.id, csrfToken);
      const created = {
        ...mapAppointmentResponse(response),
        deposit: draft.depositStatus === "PAID" ? "완료" as const : "대기" as const,
        depositUnpaidConfirmed: draft.depositStatus === "UNPAID" || undefined,
        depositAmount: draft.depositAmount,
        depositPaymentMethod:
          draft.depositStatus === "PAID" && draft.depositPaymentMethod !== "미확인"
            ? draft.depositPaymentMethod
            : undefined,
        additionalPrepayment:
          draft.depositStatus === "PAID" && draft.additionalPrepayment
            ? true
            : undefined,
      };
      setBackendAppointments((current) => [
        ...current.filter((item) => item.id !== created.id),
        created,
      ]);
      setSelectedId(created.id);
      setCalendarDate(created.date);
      setActiveView("week");
      setScheduleRevision((current) => current + 1);
      notify(`${created.name}님의 예약을 Backend에 저장했습니다.`);
    }
    setBookingModal(null);
  };

  useEffect(() => {
    if (!logoutError) return;
    setToast(logoutError);
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [logoutError]);

  useEffect(() => {
    const activeDefinition = NAVIGATION.find(
      (item) => item.id === activeView,
    );
    if (
      activeDefinition &&
      !hasAnyPermission(user, activeDefinition.permissions)
    ) {
      const firstAllowedView = visibleNavigation.find(
        (item) => item.id !== "booking",
      );
      if (firstAllowedView && firstAllowedView.id !== "booking") {
        setActiveView(firstAllowedView.id);
      }
    }
  }, [activeView, user, visibleNavigation]);

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
      if (event.key === "Escape" && drawer) {
        event.preventDefault();
        setDrawer(null);
        return;
      }
      if (bookingModal || drawer || isTyping) return;
      if (
        canCreateAppointment &&
        (event.key === "F2" || event.key.toLowerCase() === "n")
      ) {
        event.preventDefault();
        openNewBooking();
      } else if (
        canUpdateAppointment &&
        (event.key === "F4" || event.key.toLowerCase() === "e")
      ) {
        event.preventDefault();
        openEditBooking();
      } else if (canVerifyIdentity && event.key === "F6") {
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

  const normalizedCalendarSearch = search.trim().toLowerCase();
  const calendarAppointments = backendAppointments.filter((appointment) =>
    appointment.name.toLowerCase().includes(normalizedCalendarSearch) ||
    appointment.chartNumber.toLowerCase().includes(normalizedCalendarSearch),
  );

  const calendarStatus = (
    <div className={`backend-boundary ${scheduleError ? "is-error" : ""}`} role="status">
      <span><strong>Backend 일정</strong>{scheduleLoading
        ? "예약을 불러오는 중입니다."
        : scheduleError || "로그인 권한으로 조회한 저장 예약입니다."}</span>
      {scheduleError && <button type="button" className="secondary-button"
        onClick={() => setScheduleRevision((value) => value + 1)}>다시 조회</button>}
    </div>
  );

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
    if (activeView === "month") {
      return (
        <>
        {calendarStatus}
        {!scheduleLoading && !scheduleError &&
        <MonthView
          appointments={calendarAppointments}
          calendarDate={calendarDate}
          selectedDate={calendarDate}
          onSelectDate={openDay}
        />}
        </>
      );
    }
    if (activeView === "day") {
      return (
        <>
        {calendarStatus}
        {!scheduleLoading && !scheduleError &&
        <DayView
          appointments={calendarAppointments}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setDrawer({ kind: "appointment", id });
          }}
          calendarDate={calendarDate}
        />}
        </>
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
      return (
        <PatientWorkspace
          user={user}
          csrfToken={csrfToken}
          onNotify={notify}
        />
      );
    }
    if (activeView === "statistics") {
      return (
        <StatisticsView
          appointments={appointments}
          period={statisticsPeriod}
          calendarDate={calendarDate}
          onPeriodChange={setStatisticsPeriod}
        />
      );
    }
    if (activeView === "admin") return <AdminView />;

    return (
      <WeekSchedule
        appointments={calendarAppointments}
        selectedId={selectedId}
        onSelect={openAppointmentDetail}
        calendarDate={calendarDate}
        onSelectDate={openDay}
        loading={scheduleLoading}
        loadError={scheduleError}
        onRetry={() => setScheduleRevision((current) => current + 1)}
      />
    );
  };

  const drawerAppointment =
    drawer?.kind === "appointment"
      ? backendAppointments.find((appointment) => appointment.id === drawer.id) ??
        appointments.find((appointment) => appointment.id === drawer.id)
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
          {visibleNavigation.map((item) => (
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
          title="로그아웃"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
        >
          <Icon name="logout" />
          <span>{loggingOut ? "처리 중" : "로그아웃"}</span>
        </button>
      </aside>

      <header className="topbar">
        <div className="topbar__title">
          <h1>내시경 운영 시스템</h1>
          <span>Queue-First Workbench</span>
          <em>합성 데이터</em>
        </div>
        <div className="topbar__actions">
          {canCreateAppointment ? (
            <>
              <button className="same-day-button" onClick={openSameDayUpper}>
                <Icon name="today" />
                당일 위내시경
              </button>
              <button className="primary-button" onClick={openNewBooking}>
                <Icon name="add" />
                새 예약
                <kbd>F2</kbd>
              </button>
            </>
          ) : null}
          <button className="icon-button" title="알림">
            <Icon name="bell" />
            <span className="notification-dot">3</span>
          </button>
          <div className="profile-button" aria-label="현재 로그인 사용자">
            <span className="avatar avatar--small">
              {user.display_name.slice(0, 1)}
            </span>
            <span>
              <strong>{user.display_name}</strong>
              <small>{roleLabel(user.roles)}</small>
            </span>
          </div>
          <button
            className="session-button"
            title="현재 세션에서 로그아웃"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
          >
            <Icon name="logout" />
            <span>
              보안 세션
              <strong>{loggingOut ? "종료 중…" : "로그아웃"}</strong>
            </span>
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="command-bar">
          <div className="date-command">
            <button
              className="icon-button"
              title={
                activeView === "statistics" && statisticsPeriod === "year"
                  ? "이전 연도"
                  : (activeView === "month" ||
                        (activeView === "statistics" && statisticsPeriod === "month"))
                    ? "이전 달"
                    : activeView === "day"
                      ? "이전 날짜"
                      : "이전 주"
              }
              onClick={() => moveCalendar(-1)}
            >
              <Icon name="previous" />
            </button>
            <strong aria-live="polite">
              {activeView === "statistics"
                ? statisticsPeriodLabel(statisticsPeriod, calendarDate)
                : periodLabel(activeView, calendarDate)}
            </strong>
            <button
              className="icon-button"
              title={
                activeView === "statistics" && statisticsPeriod === "year"
                  ? "다음 연도"
                  : (activeView === "month" ||
                        (activeView === "statistics" && statisticsPeriod === "month"))
                    ? "다음 달"
                    : activeView === "day"
                      ? "다음 날짜"
                      : "다음 주"
              }
              onClick={() => moveCalendar(1)}
            >
              <Icon name="next" />
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setCalendarDate(REFERENCE_TODAY);
                if (!["month", "week", "day", "statistics"].includes(activeView)) {
                  setActiveView("today");
                }
              }}
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
              onSelect={openAppointmentDetail}
            />
            {renderMainView()}
          </div>
        ) : (
          <div className="view-wrapper">{renderMainView()}</div>
        )}
      </main>

      {bookingModal && (
        <BookingWizard
          appointment={editingAppointment}
          appointments={bookingModal.mode === "edit" ? appointments : backendAppointments}
          sameDay={bookingModal.mode === "same-day"}
          canApproveExtension={canApproveExtension}
          onCreateAdditionalSlot={createSameDayExtension}
          onClose={() => setBookingModal(null)}
          onSave={saveBooking}
        />
      )}

      {drawerAppointment && (
        <AppointmentDetailDialog
          appointment={drawerAppointment}
          onClose={() => setDrawer(null)}
          onEdit={() => openEditBooking(drawerAppointment.id)}
          onVerify={verifySelected}
          onCorrectVerification={correctSelectedVerification}
          onUpdate={(patch) => {
            if (drawerAppointment.backendManaged) return;
            setAppointments((current) => current.map((item) => item.id === drawerAppointment.id ? { ...item, ...patch } : item));
          }}
          canEdit={canUpdateAppointment && !drawerAppointment.backendManaged}
          canVerify={canVerifyIdentity && !drawerAppointment.backendManaged}
        />
      )}

      {drawerPathology && (
        <PathologyDrawer
          pathologyCase={drawerPathology}
          onClose={() => setDrawer(null)}
          canWrite={canWritePathology}
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

export function App() {
  const auth = useAuth();

  if (auth.phase === "checking") {
    return <AuthLoadingScreen />;
  }

  if (auth.phase === "unavailable") {
    return (
      <AuthUnavailableScreen
        message={auth.sessionNotice}
        onRetry={auth.retrySessionCheck}
      />
    );
  }

  if (!auth.user) {
    return (
      <LoginScreen
        onLogin={auth.login}
        isSubmitting={auth.phase === "authenticating"}
        error={auth.loginError}
        notice={auth.sessionNotice}
      />
    );
  }

  if (auth.user.must_change_password) {
    return (
      <ForcedPasswordChangeScreen
        user={auth.user}
        onChangePassword={auth.changePassword}
        onLogout={auth.logout}
        isSubmitting={auth.passwordChangePending}
        error={auth.passwordChangeError}
      />
    );
  }

  return (
    <Workbench
      user={auth.user}
      csrfToken={auth.csrfToken}
      onLogout={auth.logout}
      logoutError={auth.logoutError}
    />
  );
}
