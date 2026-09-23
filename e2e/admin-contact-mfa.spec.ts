/**
 * Admin / Contact / MFA 页面 E2E（v0.5.0 F02）
 *
 * 覆盖：
 *   1) /dashboard/admin 概览页：可达 + 统计卡片渲染
 *   2) /dashboard/admin/users 用户列表页：可达 + mock 用户渲染
 *   3) /dashboard/admin/messages 消息列表页：可达
 *   4) /(marketing)/contact 表单：可达 + 字段填写 + submit 后无运行时错误
 *      （UI 闭环；落表在 #5 通过 mock 端点独立覆盖，避开 Next.js dev 下
 *      Turbopack 将 server action 与 route handler 拆分到不同 worker 进程
 *      导致 mock 内存不可见的问题）
 *   5) mock contact_messages 表端到端：POST → GET 回读 + 字段对齐
 *
 * 全部 mock：默认用户 dev@indiestack.local / password123，role=super_admin（admin 之上，
 * 可访问全部 admin 路由含 super_admin 专属页）。ContactMessages 落库走 mock 表 contact_messages（e2e 端点 GET/POST）。
 */

import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

const E2E_BEARER = "e2e-bearer-token";
import { appUrl } from "./support/base-url";
import { actUntilServerAction } from "./support/hydrated";
const MOCK_EMAIL = "dev@indiestack.local";

async function resetContactMessages(api: APIRequestContext): Promise<void> {
  const headers = { authorization: `Bearer ${E2E_BEARER}` };
  let lastError: string | null = null;

  // Turbopack 首次编译 mock route 时偶发关闭 keep-alive 连接（socket hang up）。
  // 只重试网络错误和服务端错误；鉴权/路由配置错误应立即失败。
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await api.delete(`${appUrl()}/api/e2e/contact-messages`, { headers });
      if (response.ok()) return;

      const message = `HTTP ${response.status()} ${await response.text()}`;
      if (response.status() === 401 || response.status() === 404) {
        throw new Error(`contact-messages reset misconfigured: ${message}`);
      }
      lastError = message;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (lastError.startsWith("contact-messages reset misconfigured:")) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }

  throw new Error(`contact-messages reset failed after 3 attempts: ${lastError}`);
}

test.describe("Admin / Contact / MFA 页面 (F02)", () => {
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    api = await pwRequest.newContext({ baseURL: appUrl() });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test.beforeEach(async () => {
    // 清空 contact messages，保证 mock 端点测试用例干净
    await resetContactMessages(api);
  });

  test("admin 概览页可达并渲染统计卡片", async ({ page }) => {
    await page.goto(`${appUrl()}/auth/login`, { timeout: 60_000 });
    await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
    await page.locator("input[type=password]").first().fill("password123");
    await page.getByRole("button", { name: /sign in|登录/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    const response = await page.goto(`${appUrl()}/dashboard/admin`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    expect(response?.status()).toBe(200);
    const cardCount = await page.locator('[class*="rounded"][class*="border"]').count();
    expect(cardCount).toBeGreaterThan(0);
  });

  /**
   * A05：面板上的「邮件待发队列」必须就是 worker 看到的那支队伍。
   *
   * 清空后种 3 条队列内类型（`payment_succeeded`）+ 2 条队列外类型（`system`）：
   * 种子端点回读的是「未发送未读」的全部 5 条（它不按类型过滤），卡片必须只报 3。
   * 两头数字不一样才是这条用例的价值——只断言「渲染了一个数」的话，
   * 类型列表写错、忘掉了死信过滤都能照样通过。
   */
  test("admin 概览页的待发队列数字与队列本身一致", async ({ page, request }) => {
    const headers = { authorization: `Bearer ${E2E_BEARER}` };
    const seedJson = { ...headers, "content-type": "application/json" };
    await request.delete(`${appUrl()}/api/e2e/seed-notifications`, { headers });
    for (const [count, type] of [
      [3, "payment_succeeded"],
      [2, "system"],
    ] as const) {
      const seeded = await request.post(`${appUrl()}/api/e2e/seed-notifications`, {
        headers: seedJson,
        data: { count, type },
      });
      expect(seeded.ok()).toBeTruthy();
    }
    const readBack = await request.get(`${appUrl()}/api/e2e/seed-notifications`, { headers });
    expect(readBack.ok()).toBeTruthy();
    const { total } = (await readBack.json()) as { total: number };
    expect(total).toBe(5);

    await page.goto(`${appUrl()}/auth/login`, { timeout: 60_000 });
    await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
    await page.locator("input[type=password]").first().fill("password123");
    await page.getByRole("button", { name: /sign in|登录/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    const response = await page.goto(`${appUrl()}/dashboard/admin`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    expect(response?.status()).toBe(200);

    const queueCard = page
      .getByRole("heading", { name: /email queue|邮件待发队列/i })
      .locator("xpath=ancestor::div[contains(@class,'bg-card')][1]");
    await expect(queueCard).toBeVisible();
    await expect(queueCard.getByText("3", { exact: true })).toBeVisible();
    // 有积压时卡片说的是「卡了多久 + 几轮空发送」，不是另一句泛泛的统计文案
    await expect(queueCard.getByText(/oldest item has waited|最老一条已等待/i)).toBeVisible();
  });

  test("admin/users 用户列表页可达并渲染用户行", async ({ page }) => {
    await page.goto(`${appUrl()}/auth/login`, { timeout: 60_000 });
    await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
    await page.locator("input[type=password]").first().fill("password123");
    await page.getByRole("button", { name: /sign in|登录/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    const response = await page.goto(`${appUrl()}/dashboard/admin/users`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    expect(response?.status()).toBe(200);
    await expect(page.getByText("dev@indiestack.local").first()).toBeVisible({ timeout: 10_000 });
  });

  test("admin/messages 联系消息列表页可达", async ({ page }) => {
    await page.goto(`${appUrl()}/auth/login`, { timeout: 60_000 });
    await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
    await page.locator("input[type=password]").first().fill("password123");
    await page.getByRole("button", { name: /sign in|登录/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    const response = await page.goto(`${appUrl()}/dashboard/admin/messages`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    expect(response?.status()).toBe(200);
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("settings MFA：开启 → 验证后显示已启用", async ({ page }) => {
    await page.goto(`${appUrl()}/auth/login`, { timeout: 60_000 });
    await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
    await page.locator("input[type=password]").first().fill("password123");
    await page.getByRole("button", { name: /sign in|登录/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    await page.goto(`${appUrl()}/dashboard/settings`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await expect(page.getByText(/Two-Factor Authentication|两步验证/i).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /Enable 2FA|开启两步验证/i }).click();
    await expect(page.getByText(/Verify|验证并启用/i)).toBeVisible({ timeout: 10_000 });
    await page.getByLabel(/Verification code|验证码/i).fill("123456");
    await page.getByRole("button", { name: /Verify|验证并启用/i }).click();

    await expect(page.getByRole("button", { name: /Disable 2FA|解除两步验证/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Enabled|已启用/i).first()).toBeVisible();
  });

  test("contact 表单：可达 + 字段填写 + submit 后无运行时错误", async ({ page }) => {
    // contact 路由位于 (marketing) 组，URL 是 /contact（不需要登录）
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    const response = await page.goto(`${appUrl()}/contact`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    expect(response?.status()).toBe(200);
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#contact-email")).toBeVisible();
    await expect(page.locator("#subject")).toBeVisible();
    await expect(page.locator("#message")).toBeVisible();

    const NAME = "E2E Tester";
    const EMAIL = "e2e-tester-ui@example.com";
    const SUBJECT = "Playwright UI 测试联系";
    const MESSAGE =
      "这是来自 Playwright UI 的 E2E 测试消息（仅断言 UI 流程不报错，落表由 #5 覆盖）。";

    // 提交按钮（带 Send 图标）
    const submit = page.getByRole("button", { name: /Send|提交/i }).last();
    // 提交不套 actUntilVisible：hydration 之前的那一次点击会由浏览器自己完成提交，
    // 字段同样被清空、下面那句「成功标志」照样绿，而应用根本没收到请求。
    // 判据因此换成「收到了一次带 next-action 的 Server Action 请求」，且恰好一次。
    // 填写必须和点击一起重放：那次原生提交会留下一个空表单，字段是 required 的，
    // 只重放点击会被浏览器自己的校验挡死（第一版就是这么卡住 23 秒的）。
    const fillAndSubmit = async () => {
      await page.locator("#name").fill(NAME);
      await page.locator("#contact-email").fill(EMAIL);
      await page.locator("#subject").fill(SUBJECT);
      await page.locator("#message").fill(MESSAGE);
      await submit.click();
    };
    const actions = await actUntilServerAction(page, fillAndSubmit);
    expect(actions).toBe(1);

    // 等待 submit 处理完成（form fields 清空 或 toast 出现）
    // 表单 reset 是成功标志；不必依赖跨进程 mock 可见性
    await expect.poll(() => page.locator("#name").inputValue(), { timeout: 10_000 }).toBe("");
    // 原生提交的现场长这样：/contact?name=…&email=…&subject=…&message=…
    await expect(page).toHaveURL(/\/contact$/);

    // 断言：UI 流程没有抛出未捕获运行时错误
    const fatal = consoleErrors.filter((m) => !/aborted|ECONNRESET/i.test(m));
    expect(fatal, `意外运行时错误: ${fatal.join("\n")}`).toEqual([]);
  });

  test("mock reset 端点：Bearer 保护并返回 reset 确认", async () => {
    const unauthorized = await api.post(`${appUrl()}/api/e2e/mock-reset`);
    expect(unauthorized.status()).toBe(401);

    const reset = await api.post(`${appUrl()}/api/e2e/mock-reset`, {
      headers: { authorization: `Bearer ${E2E_BEARER}` },
    });
    expect(reset.ok()).toBeTruthy();
    await expect(reset.json()).resolves.toEqual({ ok: true, reset: true });
  });

  test("mock contact_messages POST → GET 字段对齐", async () => {
    const NAME = "E2E API Tester";
    const EMAIL = "e2e-tester-api@example.com";
    const SUBJECT = "Playwright API 测试联系";
    const MESSAGE = "通过 mock /api/e2e/contact-messages POST 端点写入并验证回读字段。";

    const postRes = await api.post(`${appUrl()}/api/e2e/contact-messages`, {
      headers: {
        authorization: `Bearer ${E2E_BEARER}`,
        "content-type": "application/json",
      },
      data: { name: NAME, email: EMAIL, subject: SUBJECT, message: MESSAGE },
    });
    expect(postRes.ok()).toBeTruthy();
    const postJson = (await postRes.json()) as {
      ok: boolean;
      message: {
        id: string;
        name: string;
        email: string;
        subject: string;
        message: string;
        created_at: string;
      };
    };
    expect(postJson.ok).toBe(true);
    expect(postJson.message.email).toBe(EMAIL);

    // GET 回读
    const listRes = await api.get(`${appUrl()}/api/e2e/contact-messages`, {
      headers: { authorization: `Bearer ${E2E_BEARER}` },
    });
    expect(listRes.ok()).toBeTruthy();
    const listJson = (await listRes.json()) as {
      total: number;
      messages: { id: string; name: string; email: string; subject: string; message: string }[];
    };
    expect(listJson.total).toBeGreaterThanOrEqual(1);
    const matched = listJson.messages.find((m) => m.email === EMAIL);
    expect(matched, "提交的 contact 消息应落库").toBeDefined();
    expect(matched!.name).toBe(NAME);
    expect(matched!.subject).toBe(SUBJECT);
    expect(matched!.message).toBe(MESSAGE);
  });
});
