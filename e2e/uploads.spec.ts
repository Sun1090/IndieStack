/**
 * 头像上传 E2E（v0.6.0 F07 + G08）
 *
 * 覆盖 avatar 上传的浏览器端闭环（XHR Route Handler + 共享 service + Mock storage）：
 *   1) 未选择文件时提交按钮禁用，避免无效请求
 *   2) 非白名单（PDF）→ fileTypeUnsupported
 *   3) 超过 2MB PNG → fileTooLarge
 *   4) mock storage 注入失败 1 次 → uploadFailed；同一文件重试 → 成功，
 *      且 profiles.avatar_url 真实写回（/api/user 回读断言）
 *   5) 上传中显示可访问进度并可取消
 *
 * Mock 语义：storage 层 upload/getPublicUrl 与 supabase-js 对齐；失败注入经
 * /api/e2e/mock-upload（仅 mock + Bearer），与 Route Handler 共享同一进程内存。
 */

import { test, expect, request as pwRequest, type APIRequestContext, type Page } from "@playwright/test";

const E2E_BEARER = "e2e-bearer-token";
const APP_URL = "http://localhost:3100";
const MOCK_EMAIL = "dev@indiestack.local";
const MAX_BYTES = 2 * 1024 * 1024;

const FILE_TYPE_UNSUPPORTED = /Only PNG, JPEG or WebP images are supported\.|仅支持 PNG、JPEG 或 WebP 图片。/;
const FILE_TOO_LARGE = /File exceeds the 2MB size limit\.|文件超过 2MB 大小限制。/;
const UPLOAD_FAILED = /Upload failed\. Please try again later\.|上传失败，请稍后重试。/;
const PROFILE_UPDATED = /Profile updated!|资料已更新/;
const CANCELLED = /Upload cancelled\.|上传已取消。/;

function validPng(size = 256) {
  const buffer = Buffer.alloc(Math.max(size, 12));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  return buffer;
}

test.describe("头像上传闭环 (F07 + G08)", () => {
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    api = await pwRequest.newContext({ baseURL: APP_URL });
    const res = await api.post(`${APP_URL}/api/e2e/mock-upload`, {
      headers: { authorization: `Bearer ${E2E_BEARER}`, "content-type": "application/json" },
      data: { failNext: 0 },
    });
    expect(res.ok()).toBeTruthy();
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  async function loginAndOpenEdit(page: Page) {
    await page.goto("/auth/login", { timeout: 60_000 });
    await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
    await page.locator("input[type=password]").first().fill("password123");
    await page.getByRole("button", { name: /sign in|登录/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    await page.goto("/dashboard/profile/edit", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.getByRole("button", { name: /upload avatar|上传头像/i })).toBeVisible();
  }

  /** 只匹配可见 toast 本体（li[data-state="open"]），避开 Radix 屏幕阅读器 announce 副本 */
  function visibleToast(page: Page, text: RegExp | string) {
    return page.locator('li[data-state="open"]').filter({ hasText: text }).first();
  }

  test("未选择文件时上传按钮禁用", async ({ page }) => {
    await loginAndOpenEdit(page);
    await expect(page.getByRole("button", { name: /upload avatar|上传头像/i })).toBeDisabled();
  });

  test("非白名单类型（PDF）提示 fileTypeUnsupported", async ({ page }) => {
    await loginAndOpenEdit(page);
    await page.locator("#avatar").setInputFiles({
      name: "avatar.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"),
    });
    await page.getByRole("button", { name: /upload avatar|上传头像/i }).click();
    await expect(visibleToast(page, FILE_TYPE_UNSUPPORTED)).toBeVisible({ timeout: 20_000 });
  });

  test("超过 2MB 的 PNG 提示 fileTooLarge", async ({ page }) => {
    await loginAndOpenEdit(page);
    await page.locator("#avatar").setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(MAX_BYTES + 1, 0x89),
    });
    await page.getByRole("button", { name: /upload avatar|上传头像/i }).click();
    await expect(visibleToast(page, FILE_TOO_LARGE)).toBeVisible({ timeout: 20_000 });
  });

  test("存储注入失败 → uploadFailed，重试成功并写回 avatar_url", async ({ page }) => {
    await loginAndOpenEdit(page);

    // 注入：下一次 storage.put() 返回错误
    const inject = await api.post(`${APP_URL}/api/e2e/mock-upload`, {
      headers: { authorization: `Bearer ${E2E_BEARER}`, "content-type": "application/json" },
      data: { failNext: 1 },
    });
    expect(inject.ok()).toBeTruthy();
    expect(((await inject.json()) as { failNext: number }).failNext).toBe(1);

    // 合法小图 → 首次上传失败
    await page.locator("#avatar").setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: validPng(),
    });
    await page.getByRole("button", { name: /upload avatar|上传头像/i }).click();
    await expect(visibleToast(page, UPLOAD_FAILED)).toBeVisible({ timeout: 20_000 });

    // 注入已耗尽 → 同一文件直接重试应成功
    await page.getByRole("button", { name: /upload avatar|上传头像/i }).click();
    await expect(visibleToast(page, PROFILE_UPDATED)).toBeVisible({ timeout: 20_000 });

    // avatar_url 已写回 profiles（经 /api/user 读共享 mock 内存）
    const userRes = await api.get(`${APP_URL}/api/user`);
    expect(userRes.ok()).toBeTruthy();
    const body = (await userRes.json()) as { profile: { avatar_url: string | null } };
    expect(body.profile.avatar_url).toMatch(
      /^https:\/\/mock\.supabase\.co\/storage\/v1\/object\/public\/avatars\//,
    );

    // 注入计数确认归零
    const peek = await api.get(`${APP_URL}/api/e2e/mock-upload`, {
      headers: { authorization: `Bearer ${E2E_BEARER}` },
    });
    expect(((await peek.json()) as { failNext: number }).failNext).toBe(0);
  });

  test("上传中显示进度并支持取消", async ({ page }) => {
    await loginAndOpenEdit(page);
    let releaseRoute: () => void = () => {};
    const routeBlocked = new Promise<void>((resolve) => {
      releaseRoute = resolve;
    });
    await page.route("**/api/uploads/avatar", async (route) => {
      await routeBlocked;
      await route.abort("failed").catch(() => undefined);
    });

    await page.locator("#avatar").setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: validPng(1024),
    });
    await page.getByRole("button", { name: /upload avatar|上传头像/i }).click();

    const progress = page.getByRole("progressbar", { name: /Uploading|上传中/i });
    await expect(progress).toBeVisible({ timeout: 10_000 });
    await expect(progress).toHaveAttribute("aria-valuenow", /.+/);
    await page.getByRole("button", { name: /cancel|取消/i }).click();
    await expect(visibleToast(page, CANCELLED)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    releaseRoute();
  });
});
