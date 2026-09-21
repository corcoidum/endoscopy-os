// E2E 전용 합성 계정과 주소. scripts/e2e.ps1이 같은 값으로 Backend를 띄운다.
export const E2E_FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 5174);
export const E2E_FRONTEND_ORIGIN = `http://127.0.0.1:${E2E_FRONTEND_PORT}`;
export const E2E_API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:18000";

export const E2E_ADMIN_ID = process.env.E2E_ADMIN_ID ?? "e2e.admin";
export const E2E_ADMIN_INITIAL_PASSWORD =
  process.env.E2E_ADMIN_INITIAL_PASSWORD ?? "Synthetic-E2E-Initial-42!";
export const E2E_ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? "Synthetic-E2E-Changed-42!";

/** globalSetup이 만든 합성 예약. 환경변수로 Test Worker에 전달한다. */
export type E2ESeed = {
  appointmentId: string;
  patientName: string;
  chartNumber: string;
  serviceDate: string;
  startTime: string;
  alternativeStartTime: string;
};

export function readSeed(): E2ESeed {
  const raw = process.env.E2E_SEED;
  if (!raw) throw new Error("E2E_SEED가 없습니다. globalSetup이 실행되지 않았습니다.");
  return JSON.parse(raw) as E2ESeed;
}
