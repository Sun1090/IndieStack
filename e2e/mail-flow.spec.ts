/**
 * 邮件全链路 E2E（v0.5.0 F01）
 *
 * 覆盖：
 *   1) 设置页开启营销邮件 → double opt-in 确认邮件落到 email-inbox
 *   2) 种通知 → POST /api/cron/digest → 摘要邮件落到 email-inbox + worker_runs 落表
 *   3) 注入 failNext → digest 失败回执：email_attempts 累加 + worker_runs.failed>0
 *
 * 全部 mock：Resend → /api/e2e/email-inbox，cron secret 已注入，digest 时区门控通过
 */

import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

const E2E_BEARER = "e2e-bearer-token";
const CRON_SECRET = "e2e-cron-secret";
const APP_URL = "http://localhost:3100";
const MOCK_EMAIL = "dev@indiestack.local";

test.describe("邮件全链路 (F01)", () => {
  test.describe.configure({ mode: "serial" });
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    api = await pwRequest.newContext({ baseURL: APP_URL });

    // 全链路 setup：清空收件箱 → 清空通知；cron 用受保护的 mock-only 强制门控。
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
    await page
      .getByRole("button", { name: /Save Preferences|保存更改/i })
      .first()
      .click();
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

    // 跑 digest cron（mock-only 强制门控，不改变生产时区策略）
    const cronRes = await request.post(`${APP_URL}/api/cron/digest`, {
      headers: {
        "x-cron-secret": CRON_SECRET,
        authorization: `Bearer ${E2E_BEARER}`,
        "x-e2e-force-digest": "true",
      },
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

  test("failure path: 注入 failNext → email_attempts 累加 + worker_runs.failed>0", async ({
    request,
  }) => {
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
      headers: {
        "x-cron-secret": CRON_SECRET,
        authorization: `Bearer ${E2E_BEARER}`,
        "x-e2e-force-digest": "true",
      },
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

// B10：重试上限、队列过滤与死信查询
// 保持与 happy/failure 用例相同的 mock-only 入口，验证真实 cron/repository 链路。
test.describe("通知失败回执与死信 (B10)", () => {
  test("达到重试上限后不再拉取，并可查询 dead-letter", async ({ request }) => {
    const api = await pwRequest.newContext({ baseURL: APP_URL });
    try {
      await api.delete(`${APP_URL}/api/e2e/seed-notifications`, {
        headers: { authorization: `Bearer ${E2E_BEARER}` },
      });
      const seed = await api.post(`${APP_URL}/api/e2e/seed-notifications`, {
        headers: { authorization: `Bearer ${E2E_BEARER}`, "content-type": "application/json" },
        data: { count: 1, type: "payment_succeeded" },
      });
      expect(seed.ok()).toBeTruthy();

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const inject = await api.get(`${APP_URL}/api/e2e/email-inbox?failNext=1`, {
          headers: { authorization: `Bearer ${E2E_BEARER}` },
        });
        expect(inject.ok()).toBeTruthy();
        const cron = await api.post(`${APP_URL}/api/cron/digest`, {
          headers: {
            "x-cron-secret": CRON_SECRET,
            authorization: `Bearer ${E2E_BEARER}`,
            "x-e2e-force-digest": "true",
          },
        });
        expect(cron.ok()).toBeTruthy();
        await expect
          .poll(async () => {
            const response = await api.get(`${APP_URL}/api/e2e/seed-notifications`, {
              headers: { authorization: `Bearer ${E2E_BEARER}` },
            });
            const body = (await response.json()) as {
              notifications: { metadata: { email_attempts?: number } }[];
            };
            return body.notifications[0]?.metadata?.email_attempts ?? 0;
          })
          .toBe(attempt);
      }

      const fourth = await api.post(`${APP_URL}/api/cron/digest`, {
        headers: {
          "x-cron-secret": CRON_SECRET,
          authorization: `Bearer ${E2E_BEARER}`,
          "x-e2e-force-digest": "true",
        },
      });
      expect(fourth.ok()).toBeTruthy();
      await expect(fourth.json()).resolves.toMatchObject({ sent: 0, failed: 0 });

      const deadLetters = await api.get(`${APP_URL}/api/e2e/seed-notifications?deadLetter=true`, {
        headers: { authorization: `Bearer ${E2E_BEARER}` },
      });
      expect(deadLetters.ok()).toBeTruthy();
      const body = (await deadLetters.json()) as {
        total: number;
        notifications: { metadata: { email_attempts?: number; email_error?: string } }[];
      };
      expect(body.total).toBe(1);
      expect(body.notifications[0].metadata.email_attempts).toBe(3);
      expect(body.notifications[0].metadata.email_error).toBeTruthy();
    } finally {
      await api.delete(`${APP_URL}/api/e2e/seed-notifications`, {
        headers: { authorization: `Bearer ${E2E_BEARER}` },
      });
      await api.dispose();
    }
  });
});
