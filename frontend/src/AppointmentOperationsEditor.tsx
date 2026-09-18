import { useState } from "react";
import type { Appointment, DepositPaymentMethod } from "./data";

type Props = {
  appointment: Appointment;
  mode: "screening" | "payment";
  canEdit: boolean;
  onSave: (patch: Partial<Appointment>) => void;
};

export function AppointmentOperationsEditor({ appointment, mode, canEdit, onSave }: Props) {
  const [general, setGeneral] = useState(appointment.generalScreening ?? "미확인");
  const [colorectal, setColorectal] = useState(appointment.colorectalScreening ?? "미확인");
  const [result, setResult] = useState(appointment.colorectalScreeningResult ?? "미확인");
  const [memo, setMemo] = useState(appointment.positiveScreeningColonoscopyMemo ?? "");
  const [paid, setPaid] = useState(appointment.deposit === "완료");
  const [amount, setAmount] = useState<Appointment["depositAmount"]>(appointment.depositAmount);
  const [method, setMethod] = useState<DepositPaymentMethod | "미확인">(appointment.depositPaymentMethod ?? "미확인");
  const [feedback, setFeedback] = useState("");

  return (
    <form className="appointment-record-form" onChange={() => setFeedback("")} onSubmit={(event) => {
      event.preventDefault();
      if (!canEdit) return;
      if (mode === "payment") {
        if (paid && (!amount || method === "미확인")) {
          setFeedback("수납 완료 시 예약금액과 수납 방법을 모두 선택해 주세요.");
          return;
        }
        onSave({ deposit: paid ? "완료" : "대기", depositUnpaidConfirmed: paid ? undefined : true, depositAmount: amount,
          depositPaymentMethod: paid && method !== "미확인" ? method : undefined });
      } else {
        if (colorectal === "실시" && result === "양성" && !memo.trim()) {
          setFeedback("양성 결과와 관련한 대장내시경 메모를 입력해 주세요.");
          return;
        }
        onSave({ generalScreening: general, colorectalScreening: colorectal,
          colorectalScreeningResult: colorectal === "실시" ? result : "미확인",
          positiveScreeningColonoscopyMemo: memo.trim() || undefined });
      }
      setFeedback("합성 예약 화면에 저장했습니다. 새로고침하면 초기화됩니다.");
    }}>
      <h3>{mode === "screening" ? "국가검진 실시 및 대장내시경 메모" : "예약금 수납 기록"}</h3>
      <fieldset disabled={!canEdit}>
        <div className="appointment-record-grid">
          {mode === "screening" ? <>
            <label>일반검진 실시 여부<select value={general} onChange={(e) => setGeneral(e.target.value as typeof general)}>
              {["미확인", "실시", "미실시"].map((value) => <option key={value}>{value}</option>)}
            </select></label>
            <label>대장암검진 실시 여부<select value={colorectal} onChange={(e) => setColorectal(e.target.value as typeof colorectal)}>
              {["미확인", "실시", "미실시"].map((value) => <option key={value}>{value}</option>)}
            </select></label>
            {colorectal === "실시" && <label>대장암검진 결과<select value={result} onChange={(e) => setResult(e.target.value as typeof result)}>
              {["미확인", "음성", "양성"].map((value) => <option key={value}>{value}</option>)}
            </select></label>}
            {(colorectal === "실시" && result === "양성" || memo.length > 0) && <label className="appointment-record-grid__wide">양성 후 대장내시경 관련 메모
              <textarea value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={2000} rows={3}
                placeholder="양성 결과 확인, 대장내시경 실시 여부·실시일·예정일, 안내 및 확인 사항을 기록하세요." />
            </label>}
          </> : <>
            <label>예약금액<select value={amount ?? ""} onChange={(e) => setAmount(e.target.value ? Number(e.target.value) as Appointment["depositAmount"] : undefined)}>
              <option value="">금액 미확인</option>
              {[10000, 20000, 30000].map((value) => <option key={value} value={value}>{value.toLocaleString("ko-KR")}원</option>)}
            </select></label>
            <label>수납 상태<select value={paid ? "완료" : "미수납"} onChange={(e) => setPaid(e.target.value === "완료")}>
              <option>미수납</option><option>완료</option>
            </select></label>
            <label>수납 방법<select value={method} disabled={!paid} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option>미확인</option><option>카드</option><option>현금</option>
            </select></label>
          </>}
        </div>
        {canEdit && <button className="primary-button" type="submit">{mode === "screening" ? "검진 기록 저장" : "수납 기록 저장"}</button>}
      </fieldset>
      {feedback && <p role="status">{feedback}</p>}
      <small>합성 데이터 Prototype · 현재 화면 내 기록이며 실제 환자정보를 입력하지 않습니다.</small>
    </form>
  );
}
