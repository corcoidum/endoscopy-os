import { defineConfig } from "@playwright/test";
import { E2E_API_URL, E2E_FRONTEND_ORIGIN, E2E_FRONTEND_PORT } from "./e2e/env";

// 실제 Backend와 PostgreSQL이 필요한 Browser Smoke Test.
// 보통은 scripts/e2e.ps1이 일회용 Database와 Backend를 준비한 뒤 실행한다.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: E2E_FRONTEND_ORIGIN,
    // Playwright 전용 Chromium을 내려받지 않도록 설치된 Chrome을 쓴다.
    channel: process.env.E2E_BROWSER_CHANNEL ?? "chrome",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${E2E_FRONTEND_PORT} --strictPort`,
    url: E2E_FRONTEND_ORIGIN,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { VITE_API_PROXY_TARGET: E2E_API_URL },
  },
});
