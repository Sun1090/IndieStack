/**
 * Playwright E2E 配置
 * 冒烟测试跑在本地 dev server（Mock 模式，无需真实 Supabase）
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev -p 3100",
    url: "http://localhost:3100/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_MOCK_ENABLED: "true",
      // F01 邮件全链路：Resend 指向本地捕获端点 + 显式注入 cron 鉴权密钥
      RESEND_API_URL: "http://localhost:3100/api/e2e/email-inbox",
      RESEND_API_KEY: "e2e-resend-key",
      CRON_SECRET: "e2e-cron-secret",
      NEXT_PUBLIC_APP_URL: "http://localhost:3100",
      // F01 E2E 端点通用 Bearer（seed-notifications / email-worker-runs / email-inbox DELETE）
      E2E_BEARER_TOKEN: "e2e-bearer-token",
    },
  },
});
