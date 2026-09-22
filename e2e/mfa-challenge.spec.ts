/**
 * MFA 登录挑战 E2E（v0.12.0 C03）
 *
 * 真走一遍挑战流程：密码登录 → 检测到已验证因子 → 跳 /auth/mfa → 输错码不卡按钮 →
 * 正确码达成 aal2 后进入 dashboard。
 *
 * 种子只能种在浏览器里：mock 的 Supabase 客户端就跑在浏览器侧，因子表挂在
 * `window.__indiestackMockCache__`，整页导航即重置，所以 `/api/e2e/*` 那套服务端端点帮不上
 * （服务端那份 store 与这个页面的不是同一份）。`addInitScript` 在页面脚本之前把已验证因子
 * 写进去，等价于真库里「这个账号开了 2FA」。
 *
 * 导航一律走相对路径，由 config 的 `baseURL` 决定端口——本文件因此可以在任意空闲端口上复跑，
 * 不必假设 3100 空着（本机 3100 常被别的项目的 dev server 占着）。
 */

import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./support/base-url";

const MOCK_EMAIL = "dev@indiestack.local";
const MOCK_PASSWORD = "password123";
const FACTOR_ID = "e2e-mfa-factor";

async function seedVerifiedFactor(page: Page): Promise<void> {
  await page.addInitScript((factorId) => {
    const holder = globalThis as unknown as { __indiestackMockCache__?: Record<string, unknown> };
    const cache = (holder.__indiestackMockCache__ ??= {});
    cache.MfaFactors = [
      {
        id: factorId,
        type: "totp",
        status: "verified",
        friendly_name: "E2E",
        created_at: new Date().toISOString(),
      },
    ];
  }, FACTOR_ID);
}

async function signInWithPassword(page: Page): Promise<void> {
  await page.goto(`${appUrl()}/auth/login`, { timeout: 60_000 });
  await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
  await page.locator("input[type=password]").first().fill(MOCK_PASSWORD);
  await page.getByRole("button", { name: /sign in|登录/i }).click();
}

const verifyButton = (page: Page) => page.getByRole("button", { name: /^(Verify|验证)$/ });
const codeInput = (page: Page) => page.getByLabel(/Verification code|验证码/i);

test.describe("MFA 登录挑战 (C03)", () => {
  test("已开 2FA 的账号密码登录必须走挑战页，验证通过才进 dashboard", async ({ page }) => {
    await seedVerifiedFactor(page);
    await signInWithPassword(page);

    await page.waitForURL(/\/auth\/mfa\?/, { timeout: 15_000 });
    expect(new URL(page.url()).searchParams.get("factor")).toBe(FACTOR_ID);
    await expect(page.getByText(/Two-Factor Authentication|两步验证/)).toBeVisible();

    await codeInput(page).fill("000000");
    await verifyButton(page).click();
    // 错码：留在挑战页，且按钮从 "..." 回到可点。当年卡死的是抛异常那条路径（组件级用例覆盖），
    // 这里钉住的是同一条 UI 契约在真流程里也成立：验证失败不等于把用户困在页面上。
    await expect(page).toHaveURL(/\/auth\/mfa\?/);
    await expect(verifyButton(page)).toBeEnabled({ timeout: 15_000 });

    await codeInput(page).fill("123456");
    await verifyButton(page).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });
  });

  test("未开 2FA 的账号密码登录直接进 dashboard，不被送去挑战页", async ({ page }) => {
    await signInWithPassword(page);
    await page.waitForURL("**/dashboard", { timeout: 15_000 });
  });

  test("直接访问缺 factor 的挑战页给出重新登录入口", async ({ page }) => {
    await page.goto(`${appUrl()}/auth/mfa`, { timeout: 60_000 });
    await expect(page.getByText(/Missing verification context|缺少验证上下文/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to sign in|返回登录/ })).toBeVisible();
  });
});
