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

import {
  actUntilServerAction,
  actUntilVisible,
  watchServerActions,
} from "./support/hydrated";
import { appUrl } from "./support/base-url";

const SCRIPT_DELAY_MS = 3_000;

/** 拖慢所有客户端脚本：HTML 照常渲染，hydration 晚到。 */
async function delayScripts(page: Page) {
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "script") {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SCRIPT_DELAY_MS));
    await route.continue();
  });
}

async function slowHydration(page: Page) {
  await delayScripts(page);
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

/**
 * 提交类用例为什么不能只看「表单被清空」——`actUntilServerAction` 存在的理由。
 *
 * `/contact` 的表单字段都带 `name`，所以 hydration 之前点提交时，浏览器会**自己**完成这次提交
 * 并重新渲染页面：字段同样清空、URL 同样回到 `/contact`（实测原生 POST 返回 200），
 * 但应用一次都没收到那个 Server Action。也就是说旧判据可以一直绿着，绿的是浏览器而不是应用。
 */
async function slowContact(page: Page) {
  await delayScripts(page);
  await page.goto(`${appUrl()}/contact`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.locator("#name")).toBeVisible();
}

/** 填 + 点必须是一个整体：见下面第一条用例里记录的那个坑——原生提交会留下一个空表单。 */
async function fillAndSubmit(page: Page) {
  await page.locator("#name").fill("E2E Proof");
  await page.locator("#contact-email").fill("proof@example.com");
  await page.locator("#subject").fill("proof subject");
  await page.locator("#message").fill("proof message");
  await page.getByRole("button", { name: /Send|提交/i }).last().click();
}

test.describe("hydration 抢跑：提交类动作", () => {
  test("一次原生提交能骗过「字段清空」，但应用没收到任何 Server Action", async ({ page }) => {
    await slowContact(page);
    const seen = watchServerActions(page);
    await fillAndSubmit(page);
    // 给足时间：脚本在 3s 后到达，若这次点击真被应用接住，读数不可能还是 0。
    await page.waitForTimeout(SCRIPT_DELAY_MS + 2_000);
    expect(seen.count()).toBe(0);
    await expect(page.locator("#name")).toHaveValue("");
  });

  test("同一条件下 actUntilServerAction 到达应用，并且恰好一次", async ({ page }) => {
    await slowContact(page);
    const actions = await actUntilServerAction(page, () => fillAndSubmit(page), {
      timeout: SCRIPT_DELAY_MS + 20_000,
    });
    expect(actions).toBe(1);
    await expect(page.locator("#name")).toHaveValue("");
  });
});
