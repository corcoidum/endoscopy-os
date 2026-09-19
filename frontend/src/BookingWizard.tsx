import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateAge,
  type Appointment,
} from "./data";
import {
  dayAvailability,
  formatBirthDateInput,
  morningHoursLabel,
  isValidBirthDate,
  procedureDuration,
  fromMinutes,
  standardStartsFor,
  validateBooking,
  validateSchedule,
  type BookingDraft,
  type ValidationResult,
} from "./scheduler";
import { CheckCard, EmptyState } from "./uiPrimitives";
import { Icon } from "./icons";
import type { DayPolicyLookup } from "./dayPolicies";
import { BookingDatePicker } from "./BookingDatePicker";
import {
  draftFromAppointment,
  validateBackendBookingDraft,
  WIZARD_STEPS,
} from "./bookingDraft";
import { ApiError } from "./api";
import {
  appointmentsApi,
  bookingCreateErrorMessage,
  type ScheduleAvailabilityResponse,
} from "./appointmentsApi";


export function BookingWizard({
  appointment,
  appointments,
  dayPolicy,
  sameDay = false,
  canApproveExtension,
  onCreateAdditionalSlot,
  onClose,
  onSave,
}: {
  appointment?: Appointment;
  appointments: Appointment[];
  dayPolicy: DayPolicyLookup;
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
  const [extensionStart, setExtensionStart] = useState(() =>
    fromMinutes(dayPolicy(draft.date).morningEndMinute ?? 12 * 60),
  );
  const [extensionReason, setExtensionReason] = useState("");
  const [extensionPending, setExtensionPending] = useState(false);
  const [extensionError, setExtensionError] = useState("");
  const selectedPolicy = dayPolicy(draft.date);
  // 연장 슬롯은 오전 운영 종료 후부터 14:00 전까지 30분 단위로만 열 수 있다.
  const extensionStartOptions: string[] = [];
  if (selectedPolicy.morningEndMinute !== null) {
    for (
      let minute = selectedPolicy.morningEndMinute;
      minute + 30 <= 14 * 60;
      minute += 30
    ) {
      extensionStartOptions.push(fromMinutes(minute));
    }
  }
  const effectiveExtensionStart = extensionStartOptions.includes(extensionStart)
    ? extensionStart
    : (extensionStartOptions[0] ?? extensionStart);
  const capacityLabel =
    selectedPolicy.upperCapacity === null || selectedPolicy.colonCapacity === null
      ? `${standardStartsFor(selectedPolicy).length} Slot 기반`
      : `위 ${selectedPolicy.upperCapacity} · 대장 ${selectedPolicy.colonCapacity}`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const birthDatePickerRef = useRef<HTMLInputElement>(null);

  // appointment은 존재 여부와 id만 쓰므로 `appointment?.id` 하나로
  // 두 변화를 모두 따라간다.
  const validation = useMemo(
    () =>
      appointment
        ? validateBooking(draft, appointments, dayPolicy(draft.date), appointment.id)
        : validateBackendBookingDraft(draft),
    [draft, appointments, dayPolicy, appointment?.id],
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
              // Render가 아니라 삭제 Handler가 실행될 때 평가된다.
              // oxlint-disable-next-line react/purity
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
        if (response.slots.length === 0) return;
        const starts = response.slots.map((slot) => slot.start_time.slice(0, 5));
        // 고른 시각이 아직 가능하면 그대로 두고, 아니면 첫 Slot으로 옮긴다.
        // 연장 Slot ID는 어느 쪽이든 고른 시각과 항상 짝을 맞춘다.
        // draft 전체를 의존성에 넣으면 입력할 때마다 재조회한다. Callback은 항상
        // 최신 Render의 것이라 여기서 읽는 draft 값도 최신이다.
        const index = Math.max(starts.indexOf(draft.start), 0);
        const slotId = response.slots[index].additional_slot_id ?? undefined;
        setDraft((current) =>
          current.start === starts[index] && current.additionalSlotId === slotId
            ? current
            : { ...current, start: starts[index], additionalSlotId: slotId },
        );
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
    availabilityRevision,
  ]);

  const slotStarts =
    appointment
      ? draft.bucket === "AFTERNOON_EXCEPTION"
        ? ["14:00"]
        : standardStartsFor(dayPolicy(draft.date))
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
        effectiveExtensionStart,
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
              dayPolicy={dayPolicy}
              excludeAppointmentId={appointment?.id}
              onSelectDate={(date) =>
                setDraft((current) => {
                  const { availableStarts } = dayAvailability(
                    current,
                    appointments,
                    date,
                    dayPolicy(date),
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
                  dayPolicy(draft.date),
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
                      value={effectiveExtensionStart}
                      onChange={(event) => setExtensionStart(event.target.value)}
                    >
                      {extensionStartOptions.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
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
                  {morningHoursLabel(dayPolicy(draft.date)) ?? "휴진"}
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
                    : capacityLabel}
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
