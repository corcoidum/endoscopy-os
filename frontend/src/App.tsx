import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { calendarQueries } from "./calendarQueries";
import { useDayPolicies } from "./dayPolicies";
import { BOOKING_WINDOW_END } from "./BookingDatePicker";
import {
  initialAppointments,
  initialPathologyCases,
  type Appointment,
  type PathologyCase,
} from "./data";
import {
  isDepositSelectionComplete,
  type BookingDraft,
  type ValidationResult,
} from "./scheduler";
import { useAuth } from "./auth";
import {
  AuthLoadingScreen,
  AuthUnavailableScreen,
  ForcedPasswordChangeScreen,
  LoginScreen,
} from "./AuthScreens";
import {
  BrandMark,
} from "./uiPrimitives";
import {
  addCalendarDays,
  addCalendarMonths,
  addCalendarYears,
  periodLabel,
  REFERENCE_TODAY,
  statisticsPeriodLabel,
} from "./calendarDates";
import { hasAnyPermission, NAVIGATION, roleLabel } from "./navigation";
import { Icon } from "./icons";
import { AppointmentDetailDialog } from "./AppointmentDetailDialog";
import {
  BookingWizard,
} from "./BookingWizard";
import {
  PathologyDrawer,
  PathologyLedger,
} from "./PathologyViews";
import { AdminView, ConfirmationView, StatisticsView } from "./ReportViews";
import {
  DayView,
  MonthView,
  PriorityQueue,
  TodayView,
  WeekSchedule,
} from "./ScheduleViews";
import { PatientWorkspace } from "./PatientWorkspace";
import type { AuthUser } from "./api";
import { ApiError } from "./api";
import {
  appointmentsApi,
  mapAppointmentResponse,
} from "./appointmentsApi";
import type { DrawerState, StatisticsPeriod, ViewId } from "./viewTypes";

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

  // 달력이 보여 주는 기간과 예약 Wizard가 훑는 예약 창을 모두 덮도록 규칙을 받는다.
  const calendarRange = calendarQueries(activeView, calendarDate);
  const calendarRangeStart = calendarRange[0].startDate;
  const calendarRangeEnd = calendarRange[calendarRange.length - 1].endDate;
  const { dayPolicy, error: dayPolicyError } = useDayPolicies(
    calendarRangeStart < REFERENCE_TODAY ? calendarRangeStart : REFERENCE_TODAY,
    calendarRangeEnd > BOOKING_WINDOW_END ? calendarRangeEnd : BOOKING_WINDOW_END,
    scheduleRevision,
  );

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

  // 날짜별 규칙을 못 받으면 요일 기본값으로 그리므로, 그 사실을 직원에게 알린다.
  useEffect(() => {
    if (!dayPolicyError) return;
    setToast(dayPolicyError);
    const timer = window.setTimeout(() => setToast(""), 5200);
    return () => window.clearTimeout(timer);
  }, [dayPolicyError]);

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
        dayPolicy={dayPolicy}
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
          dayPolicy={dayPolicy}
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
