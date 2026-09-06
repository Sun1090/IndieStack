/**
 * 审计日志详情 E2E（v0.6.0 F06）
 *
 * 覆盖：
 *   1) super_admin 打开 /dashboard/admin/audit-logs：mock 审计日志渲染，含 action /
 *      entity(type + id 前缀) / metadata JSON 预览 / 操作用户前缀 / 时间等详情字段
 *   2) 搜索框按 action 过滤；无结果空态；清空恢复
 *   3) 操作类型 Select 分组过滤（team 组确定性 4 行）并可恢复全部
 *
 * 全部 mock：mock profile 默认角色 super_admin（解锁 super_admin 专属页）；
 * mock audit_logs 对齐真实 schema（entity_type/entity_id/metadata）。
 * 断言只锁定确定性子集（user.login=2 行、team 组=4 行），不锁绝对总数——
 * 同一 dev server 下其它用例（如 MFA 启用）可能向 mock audit_logs 追加 auth.* 行。
 */

import { test, expect, type Page } from "@playwright/test";

const MOCK_EMAIL = "dev@indiestack.local";

async function loginAsMockUser(page: Page): Promise<void> {
  await page.goto("/auth/login", { timeout: 60_000 });
  await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
  await page.locator("input[type=password]").first().fill("password123");
  await page.getByRole("button", { name: /sign in|登录/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
}

test.describe("审计日志详情 (F06)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsMockUser(page);
  });

  test("super_admin 可查看审计列表并渲染详情字段", async ({ page }) => {
    const pageErrors: string[] = [];
    const i18nErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    // 回归守卫：action 点号→冒号映射修复前，每行都触发 next-intl MISSING_MESSAGE
    page.on("console", (msg) => {
      const text = `${msg.type()}: ${msg.text()}`;
      if (/MISSING_MESSAGE|Could not resolve/i.test(text)) i18nErrors.push(text);
    });

    await page.goto("/dashboard/admin/audit-logs", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page.getByRole("heading", { name: /审计日志|Audit Logs/i })).toBeVisible({
      timeout: 15_000,
    });

    const rows = page.locator('[data-testid="audit-log-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(20);

    // 详情字段：action 徽标（翻译后 human label）/ entity(type + id 前缀) / metadata JSON / 用户前缀 / 时间
    // 定位不依赖原始 action 文本（徽标已翻译为 User Login/用户登录），
    // 用确定性实体 + 种子 metadata 定位 user.login 种子行，避开追加的 auth.* 行。
    const loginRow = rows
      .filter({ hasText: "user / mock-use" })
      .filter({ hasText: '"method":"password"' })
      .first();
    await expect(loginRow).toBeVisible();
    await expect(loginRow).toContainText(/User Login|用户登录/);
    await expect(loginRow).toContainText("user / mock-use");
    await expect(loginRow).toContainText('"method":"password"');
    await expect(loginRow).toContainText(/\d{4}/);

    const fatal = pageErrors.filter((m) => !/aborted|ECONNRESET/i.test(m));
    expect(fatal, `意外运行时错误: ${fatal.join("\n")}`).toEqual([]);
    expect(i18nErrors, `审计 action 翻译缺失: ${i18nErrors.join("\n")}`).toEqual([]);
  });

  test("搜索可按 action 过滤，无结果空态，清空恢复", async ({ page }) => {
    await page.goto("/dashboard/admin/audit-logs", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const search = page.getByPlaceholder(/搜索操作、对象类型|Search by action/i);
    await expect(search).toBeVisible({ timeout: 15_000 });

    const rows = page.locator('[data-testid="audit-log-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });

    // mock 种子中 user.login 恒定 2 行（追加的 auth.* 行不匹配）；
    // 搜索按原始 action 过滤（数据层仍是点号 user.login），行内徽标渲染为翻译标签。
    await search.fill("user.login");
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
    await expect(rows.nth(0)).toContainText(/User Login|用户登录/);
    await expect(rows.nth(1)).toContainText(/User Login|用户登录/);

    // 无结果 → 空态
    await search.fill("no-such-action-xyz");
    await expect(page.getByText(/暂无审计日志记录|No audit logs yet/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(rows).toHaveCount(0);

    // 清空 → 恢复种子行
    await search.fill("");
    await expect.poll(async () => rows.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(20);
  });

  test("操作类型 Select 分组过滤：team 组 4 行并可恢复", async ({ page }) => {
    await page.goto("/dashboard/admin/audit-logs", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const rows = page.locator('[data-testid="audit-log-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });

    const filterSelect = page.getByRole("combobox");
    await filterSelect.click();
    await page.getByRole("option", { name: /团队相关|Team/i }).click();

    // 种子中 team.create/team.invite 恒 4 行（idx 2/3/12/13）
    await expect(rows).toHaveCount(4, { timeout: 10_000 });
    for (let i = 0; i < 4; i += 1) {
      await expect(rows.nth(i)).toContainText("team / mock-tea");
    }

    // 恢复全部操作
    await filterSelect.click();
    await page.getByRole("option", { name: /全部操作|All Actions/i }).click();
    await expect.poll(async () => rows.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(20);
  });
});
