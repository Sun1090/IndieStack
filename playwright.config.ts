/**
 * Playwright E2E 配置
 * 冒烟测试跑在本地 dev server（Mock 模式，无需真实 Supabase）
 */
import { defineConfig, devices } from "@playwright/test";

// 可变 Mock 状态由同一个 dev server 持有；不同 spec 并行时会互相清理/覆盖。
// 默认保持单 worker，PW_FULLY_PARALLEL=true 才启用隔离实验的并行基线。
// CI 的加速方式是 Playwright shard：每个 shard 是独立 job、独立 dev server，内部仍单 worker；
// 这不会让同一 Mock 状态被多个 worker 并发修改，同时保留 F04 的 fullyParallel 实验开关。
const fullyParallel = process.env.PW_FULLY_PARALLEL === "true";

export default defineConfig({
  testDir: "./e2e",
  // 默认 60s：吸收 dev server 冷编译（首屏/Stripe SDK 首载）抖动，CI 另有 retries=2
  timeout: 60_000,
  // Shared mock state remains serial by default. F04 can opt into the
  // isolation experiment without changing the stable CI baseline.
  fullyParallel,
  workers: fullyParallel ? undefined : 1,
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
      STRIPE_SECRET_KEY: "sk_test_e2e_webhook",
      STRIPE_WEBHOOK_SECRET: "whsec_e2e_webhook",
      NEXT_PUBLIC_APP_URL: "http://localhost:3100",
      // F06 Push 重试链路：web-push 适配器要求 VAPID 存在才算 configured，
      // mock 模式下传输层被 lib/mock/push-transport 替换，因此占位值即可（不参与签名）。
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "e2e-vapid-public-key",
      VAPID_PRIVATE_KEY: "e2e-vapid-private-key",
      // F01 E2E 端点通用 Bearer（seed-notifications / email-worker-runs / email-inbox DELETE）
      E2E_BEARER_TOKEN: "e2e-bearer-token",
    },
  },
});
