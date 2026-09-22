/**
 * Playwright E2E 配置
 * 冒烟测试跑在本地 dev server（Mock 模式，无需真实 Supabase）
 */
import { defineConfig, devices } from "@playwright/test";

// 可变 Mock 状态由同一个 dev server 持有；默认单 worker 串行，避免多个 spec 互相清理/覆盖。
// 仅隔离实验可设置 PW_FULLY_PARALLEL=true 启用并行基线。
const fullyParallel = process.env.PW_FULLY_PARALLEL === "true";

// 并行要真并行，隔离边界就得落在 worker 上：默认 store 是进程级的，同一个 Next 进程里的
// 并发 worker 必然互相看见对方的写入。所以这里「几台服务器 = 几个 worker」，
// spec 侧由 e2e/support/base-url.ts 的 appUrl() 按 TEST_WORKER_INDEX 选端口。
// CI 的加速方式仍是 Playwright shard：每个 shard 独立 job、独立 dev server、内部单 worker，
// 与本文件无关（见 src/lib/testing/e2e-shard-policy.test.ts 钉住的性质）。
const BASE_PORT = Number(process.env.E2E_BASE_PORT ?? 3100);
const SERVERS = fullyParallel ? Number(process.env.E2E_SERVERS ?? 3) : 1;

function serverEnv(port: number, slot: number) {
  return {
    NEXT_PUBLIC_MOCK_ENABLED: "true",
    // 同一份源码上起 N 台 dev server：Next 用 <distDir>/dev/lock 判断「本仓库已经有一个」，
    // 各用各的 distDir 才起得来（见 next.config.ts）。名字按 slot 而不是端口编——换一下
    // E2E_BASE_PORT 就会让 Next 往 tsconfig.json 里再追加一组新路径，它写的不会自己回收。
    NEXT_DIST_DIR: `.next-e2e-${slot}`,
    // F01 邮件全链路：Resend 指向本地捕获端点 + 显式注入 cron 鉴权密钥
    RESEND_API_URL: `http://localhost:${port}/api/e2e/email-inbox`,
    RESEND_API_KEY: "e2e-resend-key",
    CRON_SECRET: "e2e-cron-secret",
    STRIPE_SECRET_KEY: "sk_test_e2e_webhook",
    STRIPE_WEBHOOK_SECRET: "whsec_e2e_webhook",
    NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
    // F06 Push 重试链路：web-push 适配器要求 VAPID 存在才算 configured，
    // mock 模式下传输层被 lib/mock/push-transport 替换，因此占位值即可（不参与签名）。
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: "e2e-vapid-public-key",
    VAPID_PRIVATE_KEY: "e2e-vapid-private-key",
    // F01 E2E 端点通用 Bearer（seed-notifications / email-worker-runs / email-inbox DELETE）
    E2E_BEARER_TOKEN: "e2e-bearer-token",
  };
}

// spec 里的相对路径只用于 waitForURL / route 这类与端口无关的 glob；页面地址一律走 appUrl()。
// baseURL 保留为基准端口，供未来若有代码级依赖时使用。
export default defineConfig({
  testDir: "./e2e",
  // 默认 60s：吸收 dev server 冷编译（首屏/Stripe SDK 首载）抖动，CI 另有 retries=2
  timeout: 60_000,
  fullyParallel,
  workers: SERVERS,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${BASE_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: Array.from({ length: SERVERS }, (_, slot) => {
    const port = BASE_PORT + slot;
    return {
      command: `pnpm dev -p ${port}`,
      url: `http://localhost:${port}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: serverEnv(port, slot),
    };
  }),
});
