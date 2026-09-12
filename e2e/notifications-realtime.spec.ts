/**
 * 通知中心实时刷新 E2E（v0.6.0 G09）
 *
 * Mock 模式无法让服务端进程直接向浏览器 WebSocket 推送，因此页面订阅使用
 * 与 Supabase 相同的 postgres_changes 契约；测试在真实完成种子写入后向页面
 * 发送 mock Realtime 事件，验证过滤、router.refresh 与 UI 更新闭环。
 */

import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";

const APP_URL = "http://localhost:3100";
const E2E_BEARER = "e2e-bearer-token";
const MOCK_EMAIL = "dev@indiestack.local";
const MOCK_USER_ID = "mock-user-001";

test.describe("通知中心实时刷新 (G09)", () => {
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    api = await pwRequest.newContext({ baseURL: APP_URL });
  });

  test.beforeEach(async () => {
    await api.delete(`${APP_URL}/api/e2e/seed-notifications`, {
      headers: { authorization: `Bearer ${E2E_BEARER}` },
    });
  });

  test.afterEach(async () => {
    await api.delete(`${APP_URL}/api/e2e/seed-notifications`, {
      headers: { authorization: `Bearer ${E2E_BEARER}` },
    });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  async function loginAndOpenNotifications(page: Page) {
    await page.goto("/auth/login");
    await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
    await page.locator("input[type=password]").first().fill("password123");
    await page.getByRole("button", { name: /sign in|登录/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });
    await page.goto("/dashboard/notifications", { waitUntil: "domcontentloaded" });
  }

  test("新通知事件触发实时刷新，并严格按 user_id 过滤", async ({ page }) => {
    await loginAndOpenNotifications(page);

    const status = page.getByRole("status").filter({ hasText: /Live|实时/ });
    await expect(status).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/No notifications yet|暂无通知/)).toBeVisible();

    const seed = await api.post(`${APP_URL}/api/e2e/seed-notifications`, {
      headers: {
        authorization: `Bearer ${E2E_BEARER}`,
        "content-type": "application/json",
      },
      data: { count: 1, type: "system" },
    });
    expect(seed.ok()).toBeTruthy();

    // 错误用户的 INSERT 必须被 filter 拒绝，页面保持空态。
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("indiestack:mock-realtime", {
          detail: {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            new: { user_id: "another-user" },
          },
        }),
      );
    });
    await page.waitForTimeout(300);
    await expect(page.getByText("E2E 种子通知 #1")).toHaveCount(0);

    // 当前用户的 INSERT 触发合并刷新，新通知无需手动 reload 即出现。
    await page.evaluate((userId) => {
      window.dispatchEvent(
        new CustomEvent("indiestack:mock-realtime", {
          detail: {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            new: { user_id: userId },
          },
        }),
      );
    }, MOCK_USER_ID);

    await expect(page.getByText("E2E 种子通知 #1")).toBeVisible({ timeout: 15_000 });
    await expect(status).toBeVisible();
  });
});
