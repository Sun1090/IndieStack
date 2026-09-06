/**
 * 头像上传失败/重试 E2E（v0.6.0 F07）
 *
 * 覆盖 avatar 上传的浏览器端闭环（全部走真实 Server Action + Mock storage）：
 *   1) 空文件提交 → fileRequired
 *   2) 非白名单（PDF）→ fileTypeUnsupported
 *   3) 超过 2MB PNG → fileTooLarge
 *   4) mock storage 注入失败 1 次 → uploadFailed；同一文件重试 → 成功，
 *      且 profiles.avatar_url 真实写回（/api/user 回读断言）
 *
 * Mock 语义：storage 层 upload/getPublicUrl 与 supabase-js 对齐；失败注入经
 * /api/e2e/mock-upload（仅 mock + Bearer），与 Server Action 共享同一进程内存。
 */

import { test, expect, request as pwRequest, type APIRequestContext, type Page } from "@playwright/test";

const E2E_BEARER = "e2e-bearer-token";
const APP_URL = "http://localhost:3100";
const MOCK_EMAIL = "dev@indiestack.local";
const MAX_BYTES = 2 * 1024 * 1024;

const FILE_REQUIRED = /Please select a file to upload\.|请选择要上传的文件。/;
const FILE_TYPE_UNSUPPORTED = /Only PNG, JPEG or WebP images are supported\.|仅支持 PNG、JPEG 或 WebP 图片。/;
const FILE_TOO_LARGE = /File exceeds the 2MB size limit\.|文件超过 2MB 大小限制。/;
const UPLOAD_FAILED = /Upload failed\. Please try again later\.|上传失败，请稍后重试。/;
const PROFILE_UPDATED = /Profile updated!|资料已更新/;

test.describe("头像上传失败/重试 (F07)", () => {
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

  test("空文件提交提示 fileRequired", async ({ page }) => {
    await loginAndOpenEdit(page);
    await page.getByRole("button", { name: /upload avatar|上传头像/i }).click();
    await expect(visibleToast(page, FILE_REQUIRED)).toBeVisible({ timeout: 20_000 });
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
      buffer: Buffer.alloc(256, 0x89),
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
});
