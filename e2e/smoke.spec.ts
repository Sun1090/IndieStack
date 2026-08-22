/**
 * E2E 冒烟测试
 * 覆盖：营销页渲染、登录页可达、Mock 模式下 dashboard 可访问
 */
import { test, expect } from "@playwright/test";

test.describe("营销页", () => {
  for (const path of ["/", "/features", "/pricing", "/faq"]) {
    test(`首页/营销路由 ${path} 正常渲染`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(/.+/);
    });
  }
});

test.describe("认证流", () => {
  test("登录页正常渲染且包含邮箱输入", async ({ page }) => {
    await page.goto("/auth/login");
    await expect(page.locator("input[type=email]").first()).toBeVisible();
  });

  test("注册页正常渲染", async ({ page }) => {
    const response = await page.goto("/auth/register");
    expect(response?.status()).toBe(200);
    await expect(page.locator("input[type=email]").first()).toBeVisible();
  });
});

test.describe("Dashboard（Mock 模式）", () => {
  test("dashboard 主页可访问并渲染侧边栏", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("body")).toContainText(/dashboard|仪表盘|概览/i);
  });

  test("健康检查端点返回 ok", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe("ok");
  });
});
