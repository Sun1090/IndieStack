/**
 * 危险区域 / 账户删除 E2E（v0.6.0 H08）
 *
 * Mock 模式的 `admin.deleteUser()` 是刻意的 no-op（见 src/lib/mock/index.ts），
 * 所以本文件**不提交真正的删除**——那既证明不了删号，还会把共享 mock 进程里的
 * api_usage / audit_logs 擦掉，污染同一 dev server 上的其它用例。
 *
 * 这里锁住的是真实用户会踩到的四件事：
 *   1) 危险区域直接渲染在设置页底部，不用切换标签页就能到达；
 *   2) 删除是两步确认，空输入不可提交（防误触）；
 *   3) 短语输错时由**服务端**拒绝，并以可读、可被屏幕阅读器播报的方式呈现；
 *   4) 取消能干净地回到入口状态。
 * 真正的擦除语义（哪些行被删、审计如何匿名化）由 `src/lib/privacy/data-policy.test.ts`
 * 与迁移在真实数据库上锁定，见 docs/db/retention.md 的演练 SQL。
 */

import { expect, test, type Page } from "@playwright/test";

const APP_URL = "http://localhost:3100";

async function openDangerZone(page: Page) {
  await page.goto(`${APP_URL}/dashboard/settings`, { waitUntil: "domcontentloaded" });
  const danger = page.getByRole("heading", { name: /Danger Zone|危险区域/ });
  await expect(danger).toBeVisible();
  return danger;
}

test.describe("账户删除危险区域 (H08)", () => {
  test("危险区域在设置页底部可见，并说明会擦除哪些个人数据", async ({ page }) => {
    const danger = await openDangerZone(page);
    await danger.scrollIntoViewIfNeeded();
    await expect(danger).toBeVisible();
    await expect(
      page.getByText(/foreign keys cannot reach|外键级联覆盖不到/),
    ).toBeVisible();
  });

  test("删除是两步确认：入口 → 输入短语，空输入不可提交", async ({ page }) => {
    await openDangerZone(page);
    const deleteEntry = page.getByRole("button", { name: /Delete Account|删除账户/ });
    await expect(deleteEntry).toBeVisible();

    await deleteEntry.click();
    const input = page.getByRole("textbox");
    await expect(input).toBeVisible();
    await expect(page.getByRole("button", { name: /Confirm Delete|确认删除/ })).toBeDisabled();

    await input.fill("d");
    await expect(page.getByRole("button", { name: /Confirm Delete|确认删除/ })).toBeEnabled();
  });

  test("短语输错由服务端拒绝，错误可被辅助技术读到", async ({ page }) => {
    await openDangerZone(page);
    await page.getByRole("button", { name: /Delete Account|删除账户/ }).first().click();

    const input = page.getByRole("textbox");
    // 与界面提示不同的一项：客户端只做非空门控，真正的匹配在服务端
    await input.fill("delete me");
    await page.getByRole("button", { name: /Confirm Delete|确认删除/ }).click();

    const alert = page.getByRole("alert").filter({ hasText: /does not match|不匹配/ });
    await expect(alert).toBeVisible();
    // 仍在设置页：没有把一次失败的删除渲染成「已退出」
    await expect(page).toHaveURL(/\/dashboard\/settings/);
  });

  test("取消后回到入口状态，不留下半个删除表单", async ({ page }) => {
    await openDangerZone(page);
    await page.getByRole("button", { name: /Delete Account|删除账户/ }).first().click();
    await expect(page.getByRole("textbox")).toBeVisible();

    await page.getByRole("button", { name: /Cancel|取消/ }).click();
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });

  test("键盘可完成两步确认并停在提交前", async ({ page }) => {
    await openDangerZone(page);
    const deleteEntry = page.getByRole("button", { name: /Delete Account|删除账户/ });
    await deleteEntry.scrollIntoViewIfNeeded();
    await deleteEntry.press("Enter");

    const input = page.getByRole("textbox");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(page.getByRole("button", { name: /Confirm Delete|确认删除/ })).toBeDisabled();
  });
});
