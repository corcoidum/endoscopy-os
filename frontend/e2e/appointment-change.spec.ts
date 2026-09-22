import { expect, test } from "@playwright/test";
import { E2E_ADMIN_ID, E2E_ADMIN_PASSWORD, readSeed } from "./env";
import { appointmentCard, login, openWeekOf } from "./helpers";

test("실제 예약을 변경하고 이력을 확인한 뒤 취소한다", async ({ page }) => {
  const seed = readSeed();
  await login(page, E2E_ADMIN_ID, E2E_ADMIN_PASSWORD);

  // 1. 상세에서 예약 변경 → 다른 시각으로 저장
  await openWeekOf(page, seed.serviceDate);
  await appointmentCard(page, seed.startTime, seed.chartNumber).click();
  const detail = page.getByRole("dialog");
  await detail.getByRole("button", { name: "예약 변경" }).click();

  const change = page.getByRole("dialog", { name: "예약 변경" });
  await expect(change.getByRole("button", { name: new RegExp(`^${seed.startTime}`) })).toBeVisible();
  await change.getByRole("button", { name: new RegExp(`^${seed.alternativeStartTime}`) }).click();
  await change.getByLabel("변경 사유 (필수)").fill("E2E 환자 요청으로 시간 변경");
  await change.getByRole("button", { name: "변경 저장" }).click();

  await expect(page.locator(".toast")).toContainText("예약을 변경했습니다");
  await expect(change).toBeHidden();
  const moved = appointmentCard(page, seed.alternativeStartTime, seed.chartNumber);
  await expect(moved).toBeVisible();

  // 2. 이력 탭에 변경 전후 시각과 사유가 남는다.
  await moved.click();
  await page.getByRole("dialog").getByText("이력·결과", { exact: true }).click();
  const history = page.getByRole("list", { name: "예약 이력" });
  await expect(history).toContainText("예약 변경");
  await expect(history).toContainText(`시작: ${seed.startTime} → ${seed.alternativeStartTime}`);
  await expect(history).toContainText("E2E 환자 요청으로 시간 변경");

  // 3. 취소하면 보드에서 사라진다.
  await page.getByRole("dialog").getByRole("button", { name: "예약 취소" }).click();
  const cancel = page.getByRole("dialog", { name: "예약 취소" });
  await cancel.getByLabel("취소 사유 (필수)").fill("E2E 환자 사정으로 취소");
  await cancel.getByRole("button", { name: "예약 취소" }).click();

  await expect(page.locator(".toast")).toContainText("예약을 취소했습니다");
  await expect(moved).toBeHidden();
});
