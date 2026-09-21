import { expect, test } from "@playwright/test";
import { E2E_ADMIN_ID, E2E_ADMIN_PASSWORD, readSeed } from "./env";

test("휴진 예외를 등록·승인하면 영향받는 예약을 보여 주고, 취소할 수 있다", async ({ page }) => {
  const seed = readSeed();
  const reason = `E2E 장비 점검 ${seed.runStamp}`;

  await page.goto("/");
  await page.locator('input[autocomplete="username"]').fill(E2E_ADMIN_ID);
  await page.locator('input[autocomplete="current-password"]').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();

  await page
    .getByRole("complementary", { name: "주 메뉴" })
    .getByRole("button", { name: "관리자" })
    .click();

  // 1. 예약이 있는 날에 휴진을 승인 대기로 등록한다.
  const form = page.getByRole("form", { name: "일정 예외 등록" });
  await form.getByLabel("날짜").fill(seed.overrideDate);
  await form.getByLabel("종류").selectOption("CLOSED");
  await form.getByLabel("사유 (필수)").fill(reason);
  await form.getByRole("button", { name: "승인 대기로 등록" }).click();
  await expect(page.locator(".toast")).toContainText("승인 대기로 등록했습니다");

  const row = page
    .getByRole("list", { name: "일정 예외 목록" })
    .getByRole("listitem")
    .filter({ hasText: reason });
  await expect(row).toContainText("승인 대기");

  // 2. 승인하면 자동 취소 없이 영향받는 예약을 알려 준다.
  await row.getByRole("button", { name: "승인" }).click();
  const impacted = page.getByRole("list", { name: "영향받는 예약" });
  await expect(impacted).toContainText(`${seed.overrideStartTime}~`);
  await expect(impacted).toContainText("휴진일과 겹침");
  await expect(row).toContainText("승인됨");

  // 3. 사유를 남기고 취소한다.
  await row.getByRole("button", { name: "취소" }).click();
  await row.getByLabel("취소 사유 (필수)").fill("E2E 점검 일정 연기");
  await row.getByRole("button", { name: "예외 취소" }).click();
  await expect(page.locator(".toast")).toContainText("일정 예외를 취소했습니다");
  await expect(row).toContainText("취소됨");
  await expect(row).toContainText("E2E 점검 일정 연기");
});
