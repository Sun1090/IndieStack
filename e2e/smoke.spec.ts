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

test.describe("安全与容错", () => {
  test("安全响应头齐全（CSP / nosniff / X-Frame-Options）", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("不存在的路由返回 404 页面", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.locator("body")).not.toContainText("FUNCTION_INVOCATION_FAILED");
  });
});

test.describe("登录全流程（Mock）", () => {
  test("邮箱密码登录后跳转 dashboard", async ({ page }) => {
    await page.goto("/auth/login");
    await page.locator("input[type=email]").first().fill("dev@indiestack.local");
    await page.locator("input[type=password]").first().fill("password123");
    await page.getByRole("button", { name: /sign in|登录/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });
    expect(page.url()).toContain("/dashboard");
  });
});

test.describe("语言切换", () => {
  test("切换到 English 后 Cookie 持久化", async ({ page }) => {
    await page.goto("/");
    // 打开语言菜单并选择 English
    await page.getByRole("button", { name: "切换语言 / Switch language" }).click();
    await page.getByRole("menuitem", { name: /English/ }).click();
    // 组件通过设置 Cookie 后 reload 生效
    await page.waitForLoadState("load");
    const localeCookie = (await page.context().cookies()).find((c) => c.name === "app-locale");
    expect(localeCookie?.value).toBe("en");
  });
});

test.describe("主题切换", () => {
  test("点击切换按钮后 html 根元素 dark 类变化", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const html = page.locator("html");
    const before = await html.getAttribute("class");
    await page.getByRole("button", { name: /toggleTheme|切换主题|Toggle theme/i }).first().click();
    // next-themes 写 localStorage 并同步 class
    await page.waitForFunction(
      (prev) => document.documentElement.className !== prev,
      before ?? "",
      { timeout: 5_000 },
    );
    const after = await html.getAttribute("class");
    expect(after).not.toBe(before);
  });
});

test.describe("注册与找回密码", () => {
  test("Mock 注册流程跳转登录页", async ({ page }) => {
    await page.goto("/auth/register");
    await page.locator("input[type=email]").first().fill("new@indiestack.local");
    await page.locator("input[type=password]").first().fill("password123");
    // 可能有确认密码字段
    const confirm = page.locator("input[type=password]").nth(1);
    if (await confirm.count()) {
      await confirm.fill("password123");
    }
    await page.getByRole("button", { name: /create account|注册/i }).click();
    await page.waitForURL("**/auth/login**", { timeout: 15_000 });
  });

  test("忘记密码页正常渲染", async ({ page }) => {
    const response = await page.goto("/auth/forgot-password");
    expect(response?.status()).toBe(200);
    await expect(page.locator("input[type=email]").first()).toBeVisible();
  });

  test("重置密码页正常渲染", async ({ page }) => {
    const response = await page.goto("/auth/reset-password");
    expect(response?.status()).toBe(200);
  });
});

test.describe("Admin 扩展（Mock 模式）", () => {
  test("webhook 日志页可访问", async ({ page }) => {
    const response = await page.goto("/dashboard/admin/webhooks");
    expect(response?.status()).toBe(200);
  });

  test("audit-logs 页可访问", async ({ page }) => {
    const response = await page.goto("/dashboard/admin/audit-logs");
    expect(response?.status()).toBe(200);
  });
});
