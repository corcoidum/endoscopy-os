import { expect, test, type Page } from "@playwright/test";
import {
  E2E_ADMIN_ID,
  E2E_ADMIN_PASSWORD,
  E2E_FRONTEND_ORIGIN,
  E2E_STAFF_ID,
  E2E_STAFF_NAME,
  E2E_STAFF_PASSWORD,
  readSeed,
} from "./env";
import { appointmentCard, login, openWeekOf } from "./helpers";

/** 확인 업무 화면의 이중확인 대기 목록에서 예약 상세를 연다. */
async function openFromQueue(page: Page, chartNumber: string) {
  await page
    .getByRole("complementary", { name: "주 메뉴" })
    .getByRole("button", { name: "확인 업무" })
    .click();
  await page
    .getByRole("list", { name: "이중확인 대기 목록" })
    .getByRole("listitem")
    .filter({ hasText: chartNumber })
    .click();
  return page.getByRole("region", { name: "인적사항 이중확인" });
}

async function openFromWeek(page: Page, date: string, start: string, chartNumber: string) {
  await page
    .getByRole("complementary", { name: "주 메뉴" })
    .getByRole("button", { name: "주간" })
    .click();
  await openWeekOf(page, date);
  await appointmentCard(page, start, chartNumber).click();
  return page.getByRole("region", { name: "인적사항 이중확인" });
}

test("두 직원의 1·2차 확인 → 새로고침 → 정정 → 재확인 → 예약 변경 → 무효화", async ({
  page,
  browser,
}) => {
  const seed = readSeed();
  const chart = seed.verificationChartNumber;

  // 0. 주간 보드의 업무 Queue는 실제 예약의 이중확인 대기만 보여 주고 미연결 업무를 섞지 않는다.
  await login(page, E2E_ADMIN_ID, E2E_ADMIN_PASSWORD);
  const priority = page.getByRole("complementary", { name: "오늘 우선 처리" });
  const priorityCard = priority.getByRole("button", { name: /^이중확인/ });
  await expect(priorityCard).toBeVisible();
  await expect(priority).toContainText("아직 실제 기록과 연결하지 않아");
  await expect(priority).not.toContainText("약제확인");
  await expect(priority).not.toContainText("D-1 재연락");
  await priorityCard.click();
  await expect(page.getByRole("region", { name: "인적사항 이중확인" })).toBeVisible();
  await page.keyboard.press("Escape");

  // 1. 관리자가 1차 확인한다. 같은 계정으로는 2차 확인할 수 없다.
  let adminPanel = await openFromQueue(page, chart);
  await expect(adminPanel.locator(".verification-state")).toHaveText("1차 확인 대기");
  await adminPanel.getByLabel("확인 방법").selectOption("ID_DOCUMENT");
  await adminPanel.getByRole("button", { name: "위 정보로 1차 확인" }).click();
  await expect(page.locator(".toast")).toContainText("1차 확인을 저장했습니다");
  await expect(adminPanel.locator(".verification-state")).toHaveText("2차 확인 대기");
  await expect(adminPanel).toContainText("신분증 대조");
  await expect(adminPanel.getByRole("button", { name: "위 정보로 2차 확인" })).toBeDisabled();
  await expect(adminPanel).toContainText("1차 확인자와 같은 계정입니다");

  // 2. 다른 직원이 별도 로그인 Session에서 2차 확인한다.
  const staffContext = await browser.newContext({
    baseURL: E2E_FRONTEND_ORIGIN,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  const staff = await staffContext.newPage();
  await login(staff, E2E_STAFF_ID, E2E_STAFF_PASSWORD);
  let staffPanel = await openFromQueue(staff, chart);
  await expect(staffPanel.locator(".verification-state")).toHaveText("2차 확인 대기");
  await staffPanel.getByRole("button", { name: "위 정보로 2차 확인" }).click();
  await expect(staffPanel.locator(".verification-state")).toHaveText("이중확인 완료");
  await expect(staffPanel).toContainText(E2E_STAFF_NAME);

  // 3. 새로고침해도 저장된 확인 상태가 그대로다.
  await staff.reload();
  staffPanel = await openFromWeek(staff, seed.verificationDate, seed.verificationStartTime, chart);
  await expect(staffPanel.locator(".verification-state")).toHaveText("이중확인 완료");

  // 4. 2차 확인 정정: 버튼 → 사유 → 완료 상태 취소의 두 단계.
  await staffPanel.getByRole("button", { name: "2차 확인 정정" }).click();
  await staffPanel.getByLabel("정정 사유").fill("E2E 다른 환자 화면에서 확인함");
  await staffPanel.getByRole("button", { name: "완료 상태 취소" }).click();
  await expect(staff.locator(".toast")).toContainText("2차 확인 완료를 정정했습니다");
  await expect(staffPanel.locator(".verification-state")).toHaveText("2차 확인 대기");
  await expect(staffPanel).toContainText("2차 재확인 필요");
  await expect(staffPanel).toContainText("E2E 다른 환자 화면에서 확인함");

  // 5. 정정 뒤 다시 2차 확인한다(1차 확인은 유지돼 있다).
  await staffPanel.getByRole("button", { name: "위 정보로 2차 확인" }).click();
  await expect(staffPanel.locator(".verification-state")).toHaveText("이중확인 완료");
  await staffContext.close();

  // 6. 관리자가 예약 시각을 바꾸면 1·2차 확인이 무효가 되고 재확인이 필요하다.
  await page.keyboard.press("Escape");
  await openFromWeek(page, seed.verificationDate, seed.verificationStartTime, chart);
  await page.getByRole("dialog").getByRole("button", { name: "예약 변경" }).click();
  const change = page.getByRole("dialog", { name: "예약 변경" });
  await change
    .getByRole("button", { name: new RegExp(`^${seed.verificationAlternativeStartTime}`) })
    .click();
  await change.getByLabel("변경 사유 (필수)").fill("E2E 시각 변경");
  await change.getByRole("button", { name: "변경 저장" }).click();
  await expect(page.locator(".toast")).toContainText("예약을 변경했습니다");

  await appointmentCard(page, seed.verificationAlternativeStartTime, chart).click();
  adminPanel = page.getByRole("region", { name: "인적사항 이중확인" });
  await expect(adminPanel.locator(".verification-state")).toHaveText("재확인 필요");
  await expect(adminPanel).toContainText("시작시각");
  await expect(adminPanel).toContainText("E2E 시각 변경");
});
