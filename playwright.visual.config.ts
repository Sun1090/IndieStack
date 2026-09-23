import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression baseline.
 *
 * Baselines are generated and compared on Linux only. Run this suite in the
 * Playwright container (documented in docs/testing.md) instead of macOS to
 * avoid cross-platform font and anti-aliasing drift.
 */
export default defineConfig({
  testDir: "./e2e-visual",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.001,
      scale: "css",
    },
  },
  use: {
    baseURL: "http://localhost:3100",
    colorScheme: "light",
    locale: "en-US",
    reducedMotion: "reduce",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium-visual",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev -p 3100",
    url: "http://localhost:3100/api/health",
    // 不复用：端口上站着别的项目的服务时，截图会比着别人的应用（见 playwright.config.ts 同一条）。
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_MOCK_ENABLED: "true",
      VISUAL_REGRESSION: "1",
      RESEND_API_URL: "http://localhost:3100/api/e2e/email-inbox",
      RESEND_API_KEY: "e2e-resend-key",
      CRON_SECRET: "e2e-cron-secret",
      STRIPE_SECRET_KEY: "sk_test_e2e_webhook",
      STRIPE_WEBHOOK_SECRET: "whsec_e2e_webhook",
      NEXT_PUBLIC_APP_URL: "http://localhost:3100",
      E2E_BEARER_TOKEN: "e2e-bearer-token",
    },
  },
});
