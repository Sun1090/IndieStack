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
 * 全部 mock：默认用户 dev@indiestack.local / password123，role=admin 可访问所有
 * admin 路由。ContactMessages 落库走 mock 表 contact_messages（e2e 端点 GET/POST）。
 */

import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

const E2E_BEARER = "e2e-bearer-token";
const APP_URL = "http://localhost:3100";
const MOCK_EMAIL = "dev@indiestack.local";

test.describe("Admin / Contact / MFA 页面 (F02)", () => {
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    api = await pwRequest.newContext({ baseURL: APP_URL });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test.beforeEach(async () => {
    // 清空 contact messages，保证 mock 端点测试用例干净
    await api.delete(`${APP_URL}/api/e2e/contact-messages`, {
      headers: { authorization: `Bearer ${E2E_BEARER}` },
    });
  });

  test("admin 概览页可达并渲染统计卡片", async ({ page }) => {
    await page.goto("/auth/login", { timeout: 60_000 });
    await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
    await page.locator("input[type=password]").first().fill("password123");
    await page.getByRole("button", { name: /sign in|登录/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    const response = await page.goto("/dashboard/admin", { waitUntil: "domcontentloaded", timeout: 60_000 });
    expect(response?.status()).toBe(200);
    const cardCount = await page.locator('[class*="rounded"][class*="border"]').count();
    expect(cardCount).toBeGreaterThan(0);
  });

  test("admin/users 用户列表页可达并渲染用户行", async ({ page }) => {
    await page.goto("/auth/login", { timeout: 60_000 });
    await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
    await page.locator("input[type=password]").first().fill("password123");
    await page.getByRole("button", { name: /sign in|登录/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    const response = await page.goto("/dashboard/admin/users", { waitUntil: "domcontentloaded", timeout: 60_000 });
    expect(response?.status()).toBe(200);
    await expect(page.getByText("dev@indiestack.local").first()).toBeVisible({ timeout: 10_000 });
  });

  test("admin/messages 联系消息列表页可达", async ({ page }) => {
    await page.goto("/auth/login", { timeout: 60_000 });
    await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
    await page.locator("input[type=password]").first().fill("password123");
    await page.getByRole("button", { name: /sign in|登录/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    const response = await page.goto("/dashboard/admin/messages", { waitUntil: "domcontentloaded", timeout: 60_000 });
    expect(response?.status()).toBe(200);
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("contact 表单：可达 + 字段填写 + submit 后无运行时错误", async ({ page }) => {
    // contact 路由位于 (marketing) 组，URL 是 /contact（不需要登录）
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    const response = await page.goto("/contact", { waitUntil: "domcontentloaded", timeout: 60_000 });
    expect(response?.status()).toBe(200);
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#contact-email")).toBeVisible();
    await expect(page.locator("#subject")).toBeVisible();
    await expect(page.locator("#message")).toBeVisible();

    const NAME = "E2E Tester";
    const EMAIL = "e2e-tester-ui@example.com";
    const SUBJECT = "Playwright UI 测试联系";
    const MESSAGE = "这是来自 Playwright UI 的 E2E 测试消息（仅断言 UI 流程不报错，落表由 #5 覆盖）。";

    await page.locator("#name").fill(NAME);
    await page.locator("#contact-email").fill(EMAIL);
    await page.locator("#subject").fill(SUBJECT);
    await page.locator("#message").fill(MESSAGE);

    // 提交按钮（带 Send 图标）
    const submit = page.getByRole("button", { name: /Send|提交/i }).last();
    await submit.click();

    // 等待 submit 处理完成（form fields 清空 或 toast 出现）
    // 表单 reset 是成功标志；不必依赖跨进程 mock 可见性
    await expect
      .poll(() => page.locator("#name").inputValue(), { timeout: 10_000 })
      .toBe("");

    // 断言：UI 流程没有抛出未捕获运行时错误
    const fatal = consoleErrors.filter((m) => !/aborted|ECONNRESET/i.test(m));
    expect(fatal, `意外运行时错误: ${fatal.join("\n")}`).toEqual([]);
  });

  test("mock contact_messages POST → GET 字段对齐", async () => {
    const NAME = "E2E API Tester";
    const EMAIL = "e2e-tester-api@example.com";
    const SUBJECT = "Playwright API 测试联系";
    const MESSAGE = "通过 mock /api/e2e/contact-messages POST 端点写入并验证回读字段。";

    const postRes = await api.post(`${APP_URL}/api/e2e/contact-messages`, {
      headers: {
        authorization: `Bearer ${E2E_BEARER}`,
        "content-type": "application/json",
      },
      data: { name: NAME, email: EMAIL, subject: SUBJECT, message: MESSAGE },
    });
    expect(postRes.ok()).toBeTruthy();
    const postJson = (await postRes.json()) as {
      ok: boolean;
      message: { id: string; name: string; email: string; subject: string; message: string; created_at: string };
    };
    expect(postJson.ok).toBe(true);
    expect(postJson.message.email).toBe(EMAIL);

    // GET 回读
    const listRes = await api.get(`${APP_URL}/api/e2e/contact-messages`, {
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
