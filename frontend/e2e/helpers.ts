import { expect, type Page } from "@playwright/test";

export async function login(page: Page, loginId: string, password: string) {
  await page.goto("/");
  await page.locator('input[autocomplete="username"]').fill(loginId);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}

function mondayOf(date: string): number {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.getTime();
}

function seoulToday(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

/**
 * 주간 보드를 예약이 있는 주로 옮긴다.
 * 로딩 완료를 추측하지 않도록, 오늘이 속한 주에서 몇 주 떨어졌는지 계산해 이동한다.
 */
export async function openWeekOf(page: Page, serviceDate: string) {
  const nextWeek = page.locator('button[title="다음 주"]');
  await expect(nextWeek).toBeVisible();
  const weeks = Math.round((mondayOf(serviceDate) - mondayOf(seoulToday())) / (7 * 86400000));
  for (let index = 0; index < weeks; index += 1) {
    await nextWeek.click();
  }
}

export function appointmentCard(page: Page, start: string, chartNumber: string) {
  // 차트번호 뒤 쉼표까지 맞춰, 같은 접두어를 가진 다른 합성 환자와 구분한다.
  return page.getByRole("button", {
    name: new RegExp(`^${start}부터 .*, ${chartNumber}, `),
  });
}
