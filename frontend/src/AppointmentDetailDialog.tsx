import { useEffect, useRef, useState } from "react";
import {
  formatAgeSex,
  procedureLabel,
  type Appointment,
} from "./data";
import { StateLabel } from "./uiPrimitives";
import { formatDateKorean } from "./calendarDates";
import { Icon } from "./icons";
import { AppointmentOperationsEditor } from "./AppointmentOperationsEditor";
import { AppointmentHistoryPanel } from "./AppointmentHistoryPanel";
import { appointmentHasStarted } from "./appointmentPresentation";
import type { AppointmentReasonAction } from "./AppointmentReasonDialog";
import { AppointmentVerificationPanel } from "./AppointmentVerificationPanel";

/** Backend 예약의 인적사항 1·2차 확인에 필요한 Session·권한. */
export type VerificationAccess = {
  csrfToken: string | null;
  currentUserId: string;
  canPrimary: boolean;
  canSecondary: boolean;
  onChanged: (message: string) => void;
};

/** Backend에 저장된 예약에서만 쓰는 상태 변경 권한과 동작. */
export type BackendAppointmentActions = {
  canChange: boolean;
  canCancel: boolean;
  canRecordNoShow: boolean;
  canConfirmException: boolean;
  onAction: (action: AppointmentReasonAction) => void;
};

export function AppointmentDetailDialog({
  appointment,
  onClose,
  onEdit,
  onVerify,
  onCorrectVerification,
  onUpdate,
  canEdit,
  canVerify,
  backendActions,
  verification,
}: {
  appointment: Appointment;
  onClose: () => void;
  onEdit: () => void;
  onVerify: () => void;
  onCorrectVerification: (reason: string) => void;
  onUpdate: (patch: Partial<Appointment>) => void;
  canEdit: boolean;
  canVerify: boolean;
  backendActions?: BackendAppointmentActions;
  verification?: VerificationAccess;
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
              {appointment.backendManaged && verification ? (
                <>
                  <AppointmentVerificationPanel
                    appointmentId={appointment.id}
                    revision={appointment.rowVersion}
                    csrfToken={verification.csrfToken}
                    currentUserId={verification.currentUserId}
                    canPrimary={verification.canPrimary}
                    canSecondary={verification.canSecondary}
                    onChanged={verification.onChanged}
                  />
                  <p className="unconnected-note">
                    <Icon name="info" />
                    D-1 연락·약제 확인·예약금은 아직 실제 기록과 연결하지 않아 표시하지 않습니다.
                  </p>
                </>
              ) : (
              <>
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
              </>
              )}

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
              {appointment.backendManaged && (
                <p className="unconnected-note">
                  <Icon name="info" />
                  수면 여부 외의 준비·약제·D-1 값은 아직 실제 기록과 연결하지 않은 Prototype 기본값입니다.
                </p>
              )}
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
              {appointment.backendManaged && (
                <p className="unconnected-note">
                  <Icon name="info" />
                  예약금·수납 값은 아직 실제 기록과 연결하지 않은 Prototype 기본값입니다.
                </p>
              )}
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

          {tab === "이력·결과" && appointment.backendManaged && (
            <section className="appointment-detail-section">
              <AppointmentHistoryPanel
                appointmentId={appointment.id}
                revision={appointment.rowVersion}
              />
            </section>
          )}

          {tab === "이력·결과" && !appointment.backendManaged && (
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
          {canEdit || backendActions?.canChange ? (
            <button className="secondary-button" onClick={onEdit}>
              <Icon name="edit" />
              예약 변경
            </button>
          ) : null}
          {backendActions?.canConfirmException && appointment.exceptionPending ? (
            <button
              className="primary-button"
              onClick={() => backendActions.onAction("confirm-exception")}
            >
              <Icon name="check" />
              오후 예외 확인
            </button>
          ) : null}
          {backendActions?.canRecordNoShow ? (
            <button
              className="secondary-button"
              disabled={!appointmentHasStarted(appointment)}
              title={
                appointmentHasStarted(appointment)
                  ? undefined
                  : "예약 시작시각이 지난 뒤에 기록할 수 있습니다."
              }
              onClick={() => backendActions.onAction("no-show")}
            >
              No-show
            </button>
          ) : null}
          {backendActions?.canCancel ? (
            <button
              className="danger-button"
              onClick={() => backendActions.onAction("cancel")}
            >
              예약 취소
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
