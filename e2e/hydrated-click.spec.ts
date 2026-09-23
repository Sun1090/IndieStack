/**
 * `actUntilVisible` 到底在防什么（v0.12.0 E2E 稳定性）。
 *
 * 这条不是「顺便加个重试」的说明文，而是它的**反向证据**：把客户端脚本统一拖慢 3 秒，
 * 于是首屏 HTML 已经可见、onClick 却还没挂上。此时
 *   - 旧写法（点一次 → 等结果）必须**等不到**结果——这才是 `account-deletion` 间歇红的机制；
 *   - 新写法（先看结果、缺了才重点）必须在同一次拖慢下仍然打开表单。
 * 两条一起放着，是为了让「重试」不能被偷偷删掉：删掉之后第一条会红，
 * 只留第一条又会被「反正点一次就够了」的说法糊过去。
 */
import { expect, test, type Page } from "@playwright/test";

import { actUntilVisible } from "./support/hydrated";
import { appUrl } from "./support/base-url";

const SCRIPT_DELAY_MS = 3_000;

/** 拖慢所有客户端脚本：HTML 照常渲染，hydration 晚到。 */
async function slowHydration(page: Page) {
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "script") {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SCRIPT_DELAY_MS));
    await route.continue();
  });
  await page.goto(`${appUrl()}/dashboard/settings`, { waitUntil: "domcontentloaded" });
  // 服务端渲染的部分先到：危险区域的标题此时就可见
  await expect(page.getByRole("heading", { name: /Danger Zone|危险区域/ })).toBeVisible();
}

const entry = (page: Page) => page.getByRole("button", { name: /Delete Account|删除账户/ }).first();
// 与 account-deletion 一样按可访问名称取那一格：`actUntilVisible` 用 `isVisible()` 判断状态，
// 多匹配的 locator 在那儿会抛严格模式错误。
const confirmInput = (page: Page) => page.getByRole("textbox", { name: /to confirm|确认/i });

test.describe("hydration 抢跑", () => {
  test("脚本晚到时，一次 click 会被静默丢弃（这就是旧写法的失败机制）", async ({ page }) => {
    await slowHydration(page);
    await entry(page).click();
    await expect(confirmInput(page)).toHaveCount(0, { timeout: 1_500 });
  });

  test("同一条件下 actUntilVisible 仍然把表单打开", async ({ page }) => {
    await slowHydration(page);
    await actUntilVisible(() => entry(page).click(), confirmInput(page), {
      timeout: SCRIPT_DELAY_MS + 8_000,
    });
    await expect(confirmInput(page)).toBeVisible();
  });
});
