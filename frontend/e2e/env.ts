// E2E 전용 합성 계정과 주소. scripts/e2e.ps1이 같은 값으로 Backend를 띄운다.
export const E2E_FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 5174);
export const E2E_FRONTEND_ORIGIN = `http://127.0.0.1:${E2E_FRONTEND_PORT}`;
export const E2E_API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:18000";

export const E2E_ADMIN_ID = process.env.E2E_ADMIN_ID ?? "e2e.admin";
export const E2E_ADMIN_INITIAL_PASSWORD =
  process.env.E2E_ADMIN_INITIAL_PASSWORD ?? "Synthetic-E2E-Initial-42!";
export const E2E_ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? "Synthetic-E2E-Changed-42!";

// 2차 확인을 맡는 두 번째 합성 직원(내시경 담당). globalSetup이 API로 만든다.
export const E2E_STAFF_ID = process.env.E2E_STAFF_ID ?? "e2e.endo";
export const E2E_STAFF_NAME = "E2E 합성 내시경";
export const E2E_STAFF_INITIAL_PASSWORD = "Synthetic-E2E-Staff-Initial-42!";
export const E2E_STAFF_PASSWORD = "Synthetic-E2E-Staff-Changed-42!";

// 복용약 의사 결정의 결정 주체가 되는 합성 의사 Profile. globalSetup이 API로 만든다.
export const E2E_DOCTOR_NAME = "E2E 합성 원장";

/** globalSetup이 만든 합성 예약. 환경변수로 Test Worker에 전달한다. */
export type E2ESeed = {
  appointmentId: string;
  patientName: string;
  chartNumber: string;
  serviceDate: string;
  startTime: string;
  alternativeStartTime: string;
  /** 일정 예외 시험용 예약. 변경·취소 시험과 겹치지 않는 다른 날짜에 둔다. */
  overrideDate: string;
  overrideStartTime: string;
  /** 1·2차 확인 시험용 예약. 다른 시험과 섞이지 않도록 별도 합성 환자로 만든다. */
  verificationChartNumber: string;
  verificationDate: string;
  verificationStartTime: string;
  verificationAlternativeStartTime: string;
  /** 복용약 시험용 대장내시경 예약과, 검사일 변경 재검토에 쓸 빈 날짜. */
  medicationAppointmentId: string;
  medicationChartNumber: string;
  medicationDate: string;
  medicationStartTime: string;
  medicationNewDate: string;
  runStamp: string;
};

export function readSeed(): E2ESeed {
  const raw = process.env.E2E_SEED;
  if (!raw) throw new Error("E2E_SEED가 없습니다. globalSetup이 실행되지 않았습니다.");
  return JSON.parse(raw) as E2ESeed;
}
