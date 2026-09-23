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

import { appUrl } from "./support/base-url";
import { actUntilVisible } from "./support/hydrated";

async function openDangerZone(page: Page) {
  await page.goto(`${appUrl()}/dashboard/settings`, { waitUntil: "domcontentloaded" });
  const danger = page.getByRole("heading", { name: /Danger Zone|危险区域/ });
  await expect(danger).toBeVisible();
  return danger;
}

/**
 * 打开确认表单，把「hydration 之前那次被吞掉的 click」算进来。
 *
 * 危险区域的标题与按钮都是服务端渲染的，`toBeVisible()` 在 React 挂上 onClick 之前就会通过；
 * 那一次 click 静默丢失之后，输入框永远不等出来，用例只能撞到 60s 超时。
 * 入口写的是 `setConfirming(true)`（不是开关），所以重放是安全的——但这里的重放本来就只在
 * 结果缺席时才发生。键盘那一例传自己的 `activate`，其余走默认的点按。
 */
async function openConfirmForm(page: Page, activate?: () => Promise<unknown>) {
  const entry = page.getByRole("button", { name: /Delete Account|删除账户/ }).first();
  const input = confirmPhraseInput(page);
  await expect(entry).toBeVisible();
  await actUntilVisible(activate ?? (() => entry.click()), input);
  return input;
}

/**
 * 确认短语那一格按**可访问名称**取，而不是「页面上那个 textbox」。
 * 设置页今天只有一格文本输入，所以两种写法现在等价；但 `actUntilVisible` 要靠
 * `isVisible()` 判断「表单开了没有」，一个多匹配的 locator 在那里会直接抛严格模式错误——
 * 明天有人在设置页加一格输入（比如改邮箱），不该把这条删除用例变成随机红。
 */
function confirmPhraseInput(page: Page) {
  return page.getByRole("textbox", { name: /to confirm|确认/i });
}

test.describe("账户删除危险区域 (H08)", () => {
  test("危险区域在设置页底部可见，并说明会擦除哪些个人数据", async ({ page }) => {
    const danger = await openDangerZone(page);
    await danger.scrollIntoViewIfNeeded();
    await expect(danger).toBeVisible();
    await expect(page.getByText(/foreign keys cannot reach|外键级联覆盖不到/)).toBeVisible();
  });

  test("删除是两步确认：入口 → 输入短语，空输入不可提交", async ({ page }) => {
    await openDangerZone(page);
    const input = await openConfirmForm(page);
    await expect(page.getByRole("button", { name: /Confirm Delete|确认删除/ })).toBeDisabled();

    await input.fill("d");
    await expect(page.getByRole("button", { name: /Confirm Delete|确认删除/ })).toBeEnabled();
  });

  test("短语输错由服务端拒绝，错误可被辅助技术读到", async ({ page }) => {
    await openDangerZone(page);
    const input = await openConfirmForm(page);
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
    await openConfirmForm(page);

    await page.getByRole("button", { name: /Cancel|取消/ }).click();
    await expect(confirmPhraseInput(page)).toHaveCount(0);
  });

  test("键盘可完成两步确认并停在提交前", async ({ page }) => {
    await openDangerZone(page);
    const entry = page.getByRole("button", { name: /Delete Account|删除账户/ }).first();
    const input = await openConfirmForm(page, async () => {
      await entry.scrollIntoViewIfNeeded();
      await entry.press("Enter");
    });

    await expect(input).toBeFocused();
    await expect(page.getByRole("button", { name: /Confirm Delete|确认删除/ })).toBeDisabled();
  });
});
