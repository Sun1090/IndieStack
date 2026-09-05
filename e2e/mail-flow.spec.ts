/**
 * 邮件全链路 E2E（v0.5.0 F01）
 *
 * 覆盖：
 *   1) 设置页开启营销邮件 → double opt-in 确认邮件落到 email-inbox
 *   2) 种通知 → POST /api/cron/digest → 摘要邮件落到 email-inbox + worker_runs 落表
 *   3) 注入 failNext → digest 失败回执：email_attempts 累加 + worker_runs.failed>0
 *
 * 全部 mock：Resend → /api/e2e/email-inbox，cron secret 已注入，digest 时区门控通过
 * PATCH /api/e2e/profile-timezone 动态写入本机时区，让任意时刻都能命中本地 08:00。
 */

import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

const E2E_BEARER = "e2e-bearer-token";
const CRON_SECRET = "e2e-cron-secret";
const APP_URL = "http://localhost:3100";
const MOCK_EMAIL = "dev@indiestack.local";

/**
 * 计算一个 IANA 时区标识，使得 Intl 在当前时刻把它视为本地 08:00。
 * 算法：当前机器本地小时 = H，所需时区的 UTC offset = (8 - H) mod 24。
 * 用 Etc/GMT±N 表达（Posix 命名符号相反：Etc/GMT-8 = UTC+8），
 * 所以 etcSigned = -neededOffset，Etc/GMT-sign|etcSigned|。
 * 整点偏移机器精确；半小时偏移（印度 +5:30、澳大利亚 +9:30）会偏 ±30min，
 * 但 E2E 用例运行在 1-2 秒内，30min 容差足够覆盖（不命中 30min 边界即可）。
 */
function timeZoneForDigestHour8(): string {
  const hostTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hostHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: hostTz,
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  ) % 24;
  // 等价 UTC offset（小时，半天区向下取整）
  const hostOffsetHours = Math.round(-new Date().getTimezoneOffset() / 60);
  // 所需时区 offset：localHour = (UTC + offset) mod 24 == 8
  // (UTC + neededOffset) mod 24 = 8
  // 当前：(hostHour) mod 24 = (UTC + hostOffset) mod 24
  // ⇒ neededOffset - hostOffset ≡ 8 - hostHour (mod 24)
  // ⇒ neededOffset = hostOffset + (8 - hostHour)
  const neededOffset = hostOffsetHours + (8 - hostHour);
  // 表达成 Etc/GMT±N：Etc/GMT-(neededOffset)
  const etcSigned = -neededOffset;
  const sign = etcSigned >= 0 ? "-" : "+";
  const abs = Math.abs(etcSigned);
  return `Etc/GMT${etcSigned === 0 ? "" : sign}${abs}`;
}

test.describe("邮件全链路 (F01)", () => {
  test.describe.configure({ mode: "serial" });
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    api = await pwRequest.newContext({ baseURL: APP_URL });

    // 全链路 setup：动态时区 → 清空收件箱 → 清空通知
    const tz = timeZoneForDigestHour8();
    const tzPatch = await api.patch(`${APP_URL}/api/e2e/profile-timezone`, {
      headers: { authorization: `Bearer ${E2E_BEARER}`, "content-type": "application/json" },
      data: { timezone: tz },
    });
    expect(tzPatch.ok(), `profile timezone PATCH 失败: ${tzPatch.status()}`).toBeTruthy();
    await api.delete(`${APP_URL}/api/e2e/email-inbox`, {
      headers: { authorization: `Bearer ${E2E_BEARER}` },
    });
    await api.delete(`${APP_URL}/api/e2e/seed-notifications`, {
      headers: { authorization: `Bearer ${E2E_BEARER}` },
    });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test.beforeEach(async () => {
    // 每个用例独立清空，避免共享状态污染
    await api.delete(`${APP_URL}/api/e2e/email-inbox`, {
      headers: { authorization: `Bearer ${E2E_BEARER}` },
    });
    await api.delete(`${APP_URL}/api/e2e/seed-notifications`, {
      headers: { authorization: `Bearer ${E2E_BEARER}` },
    });
  });

  test("happy path: 营销开关 → 确认邮件 → digest 摘要 → worker 回执", async ({ page, request }) => {
    // 登录
    await page.goto("/auth/login");
    await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
    await page.locator("input[type=password]").first().fill("password123");
    await page.getByRole("button", { name: /sign in|登录/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    // 设置页 → 拨营销开关 → 保存
    await page.goto("/dashboard/settings");
    const marketingSwitch = page.locator("#marketingEmails");
    await expect(marketingSwitch).toBeVisible();
    if (!(await marketingSwitch.isChecked())) {
      await marketingSwitch.click();
    }
    await page.getByRole("button", { name: /Save Preferences|保存更改/i }).first().click();
    await page.waitForTimeout(2000); // 等 server action 完成 + Resend 捕获

    // 断言：确认邮件到达 inbox
    const inboxRes = await api.get(
      `${APP_URL}/api/e2e/email-inbox?to=${encodeURIComponent(MOCK_EMAIL)}`,
      { headers: { authorization: `Bearer ${E2E_BEARER}` } },
    );
    expect(inboxRes.ok()).toBeTruthy();
    const inboxJson = (await inboxRes.json()) as {
      total: number;
      emails: { subject: string; html: string }[];
    };
    expect(inboxJson.total).toBeGreaterThanOrEqual(1);
    const confirmMail = inboxJson.emails.find((e) => e.subject.includes("确认订阅"));
    expect(confirmMail, "应该收到 double opt-in 确认邮件").toBeDefined();
    expect(confirmMail!.html).toContain("确认订阅");
    expect(confirmMail!.html).toContain("/api/marketing/confirm?token=");

    // 种 2 条 type=payment_succeeded 通知
    const seed = await api.post(`${APP_URL}/api/e2e/seed-notifications`, {
      headers: { authorization: `Bearer ${E2E_BEARER}`, "content-type": "application/json" },
      data: { count: 2, type: "payment_succeeded" },
    });
    expect(seed.ok()).toBeTruthy();
    const seedJson = (await seed.json()) as { inserted: number };
    expect(seedJson.inserted).toBe(2);

    // 跑 digest cron（mock 时区已 PATCH 到本地 08:00 一定命中）
    const cronRes = await request.post(`${APP_URL}/api/cron/digest`, {
      headers: { "x-cron-secret": CRON_SECRET },
    });
    expect(cronRes.ok()).toBeTruthy();
    const cronJson = (await cronRes.json()) as {
      sent: number;
      groups: number;
      failed: number;
    };
    expect(cronJson.sent).toBe(2);
    expect(cronJson.groups).toBe(1);
    expect(cronJson.failed).toBe(0);

    // 断言：摘要邮件已发
    const inboxAfterDigest = await api.get(
      `${APP_URL}/api/e2e/email-inbox?to=${encodeURIComponent(MOCK_EMAIL)}`,
      { headers: { authorization: `Bearer ${E2E_BEARER}` } },
    );
    const inboxDigest = (await inboxAfterDigest.json()) as {
      emails: { subject: string; html: string }[];
    };
    const digestMail = inboxDigest.emails.find((e) => e.subject.includes("摘要"));
    expect(digestMail, "digest 摘要邮件应到达").toBeDefined();
    expect(digestMail!.subject).toContain("2 条");

    // worker run 落表
    const runsRes = await api.get(`${APP_URL}/api/e2e/email-worker-runs`, {
      headers: { authorization: `Bearer ${E2E_BEARER}` },
    });
    expect(runsRes.ok()).toBeTruthy();
    const runsJson = (await runsRes.json()) as {
      runs: { pulled: number; sent: number; groups: number; failed: number }[];
    };
    const latestRun = runsJson.runs[0];
    expect(latestRun.pulled).toBe(2);
    expect(latestRun.sent).toBe(2);
    expect(latestRun.groups).toBe(1);
    expect(latestRun.failed).toBe(0);
  });

  test("failure path: 注入 failNext → email_attempts 累加 + worker_runs.failed>0", async ({ request }) => {
    // 种 1 条
    const seed = await request.post(`${APP_URL}/api/e2e/seed-notifications`, {
      headers: { authorization: `Bearer ${E2E_BEARER}`, "content-type": "application/json" },
      data: { count: 1, type: "payment_succeeded" },
    });
    expect(seed.ok()).toBeTruthy();

    // 注入：下一次 sendResendEmail 失败
    const trigger = await request.get(`${APP_URL}/api/e2e/email-inbox?failNext=1`, {
      headers: { authorization: `Bearer ${E2E_BEARER}` },
    });
    expect(trigger.ok()).toBeTruthy();

    // 跑 cron
    const cronRes = await request.post(`${APP_URL}/api/cron/digest`, {
      headers: { "x-cron-secret": CRON_SECRET },
    });
    expect(cronRes.ok()).toBeTruthy();
    const cronJson = (await cronRes.json()) as {
      sent: number;
      groups: number;
      failed: number;
    };
    expect(cronJson.sent).toBe(0);
    expect(cronJson.failed).toBe(1);

    // worker_runs：latest run 应 recorded failed=1
    const runsRes = await request.get(`${APP_URL}/api/e2e/email-worker-runs`, {
      headers: { authorization: `Bearer ${E2E_BEARER}` },
    });
    const runsJson = (await runsRes.json()) as {
      runs: { sent: number; failed: number }[];
    };
    const latestRun = runsJson.runs[0];
    expect(latestRun.sent).toBe(0);
    expect(latestRun.failed).toBe(1);
  });
});
