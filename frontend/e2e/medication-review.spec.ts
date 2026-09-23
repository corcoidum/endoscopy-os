import { expect, test, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import {
  E2E_ADMIN_ID,
  E2E_ADMIN_PASSWORD,
  E2E_API_URL,
  E2E_DOCTOR_NAME,
  E2E_FRONTEND_ORIGIN,
  readSeed,
} from "./env";
import { appointmentCard, login, openWeekOf } from "./helpers";

/** 주간 보드에서 예약을 열고 준비·약제 탭의 복용약 Panel을 돌려준다. */
async function openMedicationPanel(page: Page, date: string, start: string, chartNumber: string) {
  await openWeekOf(page, date);
  await appointmentCard(page, start, chartNumber).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "준비·약제", exact: true }).click();
  return dialog.getByRole("region", { name: "대장내시경 복용약" });
}

/** 화면과 별도의 관리자 Session으로 검사일만 바꾼다(다른 직원이 일정을 바꾼 상황). */
async function changeServiceDate(
  playwright: PlaywrightWorkerArgs["playwright"],
  appointmentId: string,
  serviceDate: string,
) {
  const api = await playwright.request.newContext({
    baseURL: E2E_API_URL,
    extraHTTPHeaders: { Origin: E2E_FRONTEND_ORIGIN },
  });
  try {
    const login = await api.post("/api/auth/login", {
      data: { login_id: E2E_ADMIN_ID, password: E2E_ADMIN_PASSWORD },
    });
    expect(login.status()).toBe(200);
    const csrf = String((await login.json()).csrf_token);
    const current = await (await api.get(`/api/appointments/${appointmentId}`)).json();
    const changed = await api.patch(`/api/appointments/${appointmentId}`, {
      headers: { "X-CSRF-Token": csrf },
      data: {
        row_version: current.row_version,
        reason: "E2E 검사일 변경",
        service_date: serviceDate,
      },
    });
    expect(changed.status()).toBe(200);
    expect((await changed.json()).medication_state).toBe("RE_REVIEW_REQUIRED");
  } finally {
    await api.dispose();
  }
}

test("대장내시경 복용약 확인 → 의사 결정 → 안내·실제 중단 확인 → 검사일 변경 재검토", async ({
  page,
  playwright,
}) => {
  const seed = readSeed();
  const chart = seed.medicationChartNumber;
  await login(page, E2E_ADMIN_ID, E2E_ADMIN_PASSWORD);

  let panel = await openMedicationPanel(page, seed.medicationDate, seed.medicationStartTime, chart);
  const state = () => panel.getByLabel(/^약제 상태 /);
  await expect(state()).toHaveText("약제 확인 필요");
  await expect(panel).toContainText("약제 중단 여부는 담당 의사의 확인이 필요합니다.");

  // 1. 전체 복용약 목록과 복용 분류를 확인한다.
  await panel.getByRole("radio", { name: "복용약 목록 확인" }).check();
  await panel.getByLabel(/^전체 복용약 목록/).fill("합성약 A 1정 아침, 합성 항혈소판제 1정 저녁");
  await panel.getByRole("checkbox", { name: "항혈소판제" }).check();
  await panel.getByRole("button", { name: "복용약 확인 저장" }).click();
  await expect(page.locator(".toast")).toContainText("복용약 확인을 저장했습니다");
  await expect(state()).toHaveText("약제 확인 완료");

  // 2. 중단 검토 약을 더하면 의사 확인이 필요하다.
  await panel.getByLabel("약품명").fill("합성 항혈소판제");
  await panel.getByRole("button", { name: "중단 검토 약 추가" }).click();
  await expect(state()).toHaveText("의사 확인 필요");
  const item = panel
    .getByRole("list", { name: "중단 검토 약 목록" })
    .getByRole("listitem")
    .filter({ hasText: "합성 항혈소판제" });

  // 3. 의사가 정한 중단 일수를 명시 확인과 함께 기록한다. 결정 의사는 활성 의사 Profile이다.
  await item.getByRole("button", { name: "의사 결정 기록" }).click();
  await expect(item).toContainText(`결정 의사: ${E2E_DOCTOR_NAME}`);
  await item.getByLabel("의사가 정한 중단 일수 (1~90)").fill("7");
  const save = item.getByRole("button", { name: "결정 저장" });
  await expect(save).toBeDisabled();
  await item.getByRole("checkbox", { name: /담당 의사가 결정한 내용임을 확인했습니다/ }).check();
  await save.click();
  await expect(state()).toHaveText("환자 안내 필요");
  await expect(item).toContainText("중단 7일");
  await expect(item).toContainText(`결정 의사 ${E2E_DOCTOR_NAME}`);

  // 4. 환자 안내와 실제 중단 확인을 기록한다.
  await item.getByRole("button", { name: "환자 안내 완료 기록" }).click();
  await expect(state()).toHaveText("약제 확인 완료");
  await item.getByRole("button", { name: "실제 중단 확인 기록" }).click();
  await expect(item).toContainText("확인 ·");

  // 5. 다른 직원이 검사일을 바꾸면 기존 결정은 남고 의사 재검토가 필요하다.
  await changeServiceDate(playwright, seed.medicationAppointmentId, seed.medicationNewDate);
  await page.reload();
  panel = await openMedicationPanel(page, seed.medicationNewDate, seed.medicationStartTime, chart);
  await expect(state()).toHaveText("약제 재검토 필요");
  await expect(item).toContainText("검사일이 바뀌어 의사 재검토가 필요합니다");
  await expect(item.getByRole("button", { name: "환자 안내 완료 기록" })).toHaveCount(0);

  // 6. 시스템은 새 중단일을 정하지 않는다. 의사가 다시 결정해야 한다.
  await item.getByRole("button", { name: "의사 결정 다시 기록" }).click();
  await item.getByLabel("의사가 정한 중단 일수 (1~90)").fill("5");
  await item.getByRole("checkbox", { name: /담당 의사가 결정한 내용임을 확인했습니다/ }).check();
  await item.getByRole("button", { name: "결정 저장" }).click();
  await expect(state()).toHaveText("환자 안내 필요");
  await expect(item).toContainText("중단 5일");

  // 이전 결정과 안내 기록은 이력에 그대로 남는다.
  await panel.getByText(/^복용약 기록 이력/).click();
  const history = panel.locator(".verification-history");
  await expect(history).toContainText("중단 7일 · 이후 결정으로 대체");
  await expect(history).toContainText("안내");
});
