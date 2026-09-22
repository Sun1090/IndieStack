/**
 * E2E 冒烟测试
 * 覆盖：营销页渲染、登录页可达、Mock 模式下 dashboard 可访问
 */
import { test, expect } from "@playwright/test";
import { appUrl } from "./support/base-url";

test.describe("营销页", () => {
  for (const path of ["/", "/features", "/pricing", "/faq"]) {
    test(`首页/营销路由 ${path} 正常渲染`, async ({ page }) => {
      const response = await page.goto(`${appUrl()}${path}`);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(/.+/);
    });
  }
});

test.describe("认证流", () => {
  test("登录页正常渲染且包含邮箱输入", async ({ page }) => {
    await page.goto(`${appUrl()}/auth/login`);
    await expect(page.locator("input[type=email]").first()).toBeVisible();
  });

  test("注册页正常渲染", async ({ page }) => {
    const response = await page.goto(`${appUrl()}/auth/register`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("input[type=email]").first()).toBeVisible();
  });
});

test.describe("Dashboard（Mock 模式）", () => {
  test("dashboard 主页可访问并渲染侧边栏", async ({ page }) => {
    await page.goto(`${appUrl()}/dashboard`);
    await expect(page.locator("body")).toContainText(/dashboard|仪表盘|概览/i);
  });

  test("健康检查端点返回 ok", async ({ request }) => {
    const response = await request.get(`${appUrl()}/api/health`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe("ok");
  });
});

test.describe("安全与容错", () => {
  test("运维 cron 端点未授权时拒绝访问", async ({ request }) => {
    const anonymous = await request.get(`${appUrl()}/api/ops/supabase-restore`);
    expect(anonymous.status()).toBe(401);
    expect(anonymous.headers()["cache-control"]).toBe("no-store");

    const wrongSecret = await request.get(`${appUrl()}/api/ops/supabase-restore`, {
      headers: { "x-cron-secret": "wrong-secret" },
    });
    expect(wrongSecret.status()).toBe(401);

    // 正确的 bearer 只做鉴权断言，不在 E2E 中触发真实 Management API 调用
    const body = await anonymous.json();
    expect(body).toEqual({ ok: false, error: "Unauthorized" });
  });

  test("安全响应头齐全（CSP / nosniff / X-Frame-Options）", async ({ request }) => {
    const response = await request.get(`${appUrl()}/`);
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("不存在的路由返回 404 页面", async ({ page }) => {
    const response = await page.goto(`${appUrl()}/this-page-does-not-exist`);
    expect(response?.status()).toBe(404);
    await expect(page.locator("body")).not.toContainText("FUNCTION_INVOCATION_FAILED");
  });
});

test.describe("登录全流程（Mock）", () => {
  test("邮箱密码登录后跳转 dashboard", async ({ page }) => {
    await page.goto(`${appUrl()}/auth/login`);
    await page.locator("input[type=email]").first().fill("dev@indiestack.local");
    await page.locator("input[type=password]").first().fill("password123");
    await page.getByRole("button", { name: /sign in|登录/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });
    expect(page.url()).toContain("/dashboard");
  });
});

test.describe("语言切换", () => {
  test("键盘可打开语言菜单并识别当前语言", async ({ page }) => {
    await page.goto(`${appUrl()}/`);
    const trigger = page.getByRole("button", { name: "切换语言 / Switch language" });
    await trigger.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.locator('[role="menuitem"][aria-current="true"]')).toHaveText(/English/);

    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });

  test("切换到 English 后 Cookie 持久化", async ({ page }) => {
    await page.goto(`${appUrl()}/`);
    // 打开语言菜单并选择 English
    await page.getByRole("button", { name: "切换语言 / Switch language" }).click();
    await page.getByRole("menuitem", { name: /English/ }).click();
    // 组件通过设置 Cookie 后 reload 生效
    await page.waitForLoadState("load");
    const localeCookie = (await page.context().cookies()).find((c) => c.name === "app-locale");
    expect(localeCookie?.value).toBe("en");
  });

  test("切换到简体中文后页面真的渲染中文文案", async ({ page }) => {
    await page.goto(`${appUrl()}/`);
    const badge = page.getByText("Production-Ready IndieStack", { exact: true });
    await expect(badge).toBeVisible();

    await page.getByRole("button", { name: "切换语言 / Switch language" }).click();
    await page.getByRole("menuitem", { name: /简体中文/ }).click();
    await page.waitForLoadState("load");

    const localeCookie = (await page.context().cookies()).find((c) => c.name === "app-locale");
    expect(localeCookie?.value).toBe("zh-CN");
    // 默认语言本来就是 en，只断言 cookie 无法证明消息加载成功：
    // next-intl 取不到 zh-CN 消息时会把键名或英文原文渲染出来，页面依然「正常」。
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByText("生产就绪的 SaaS 启动模板", { exact: true })).toBeVisible();
    await expect(badge).toHaveCount(0);
  });
});

test.describe("主题切换", () => {
  test("点击切换按钮后 html 根元素 dark 类变化", async ({ page }) => {
    await page.goto(`${appUrl()}/`, { waitUntil: "domcontentloaded" });
    const html = page.locator("html");
    const toggle = page
      .getByRole("button", {
        name: /toggleTheme|切换主题|Toggle theme/i,
      })
      .first();

    // G05 起首屏内联脚本已在 hydration 前写好主题 class，class 不再"从无到有"，
    // 因此必须由真实点击驱动；重试用于吸收 dev server 冷编译导致的 hydration 延迟
    // （未 hydrate 的按钮点击会被丢弃）。
    await expect(async () => {
      const before = (await html.getAttribute("class")) ?? "";
      await toggle.click();
      await expect(html).not.toHaveAttribute("class", before);
    }).toPass({ timeout: 15_000 });
  });
});

test.describe("注册与找回密码", () => {
  test("Mock 注册流程跳转登录页", async ({ page }) => {
    await page.goto(`${appUrl()}/auth/register`);
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
    const response = await page.goto(`${appUrl()}/auth/forgot-password`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("input[type=email]").first()).toBeVisible();
  });

  test("重置密码页正常渲染", async ({ page }) => {
    const response = await page.goto(`${appUrl()}/auth/reset-password`);
    expect(response?.status()).toBe(200);
  });
});

test.describe("Admin 扩展（Mock 模式）", () => {
  test("webhook 日志页可访问", async ({ page }) => {
    const response = await page.goto(`${appUrl()}/dashboard/admin/webhooks`);
    expect(response?.status()).toBe(200);
  });

  test("audit-logs 页可访问", async ({ page }) => {
    const response = await page.goto(`${appUrl()}/dashboard/admin/audit-logs`);
    expect(response?.status()).toBe(200);
  });
});

test.describe("a11y", () => {
  test("skip-to-content 链接存在且指向主内容锚点", async ({ page }) => {
    await page.goto(`${appUrl()}/`);
    const skip = page.locator('a[href="#main-content"]');
    await expect(skip).toBeAttached();
    // 键盘聚焦后可见
    await skip.focus();
    await expect(skip).toBeVisible();
  });

  test("html lang 属性为 en（默认语言）", async ({ page }) => {
    await page.goto(`${appUrl()}/`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test.describe("安全头细节", () => {
  test("CSP 含 nonce 机制与 strict-dynamic（脚本不再依赖全局 unsafe-inline）", async ({
    request,
  }) => {
    const response = await request.get(`${appUrl()}/`);
    const csp = response.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("strict-dynamic");
    expect(csp).toMatch(/nonce-/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  test("响应携带 x-request-id 用于链路追踪", async ({ request }) => {
    const response = await request.get(`${appUrl()}/api/health`);
    expect(response.headers()["x-request-id"]).toBeTruthy();
  });
});
