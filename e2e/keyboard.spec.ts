import { expect, test, type Page } from "@playwright/test";

/**
 * G07 键盘与 screen reader 交互回归。
 *
 * 覆盖键盘用户与辅助技术实际走的路径：
 * 1. 跳转链接是首个 Tab 焦点，激活后焦点落到 `#main-content`（可继续 Tab 进入正文）；
 * 2. 移动端页头菜单可按 Esc 关闭，并把焦点交还给汉堡按钮；
 * 3. 仪表盘侧边栏折叠按钮暴露可访问名称与 `aria-expanded`，折叠后图标链接仍有名称；
 * 4. 快捷键帮助对话框（`?`）的开关与焦点归还；
 * 5. 命令面板输入框里输入 `?` 是文本，不应弹出快捷键帮助。
 *
 * 断言全部基于角色 / 可访问名称而非 CSS 选择器，等价于屏幕阅读器看到的树。
 */

const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

const SKIP_LINK = /Skip to content|跳到主要内容/;
const MENU_BUTTON = /^菜单$|^Menu$/;
const SHORTCUTS_BUTTON = /shortcuts/i;
const SHORTCUTS_TITLE = /Keyboard Shortcuts|键盘快捷键/;
const COLLAPSE_BUTTON = /Collapse sidebar|收起侧边栏/;
const EXPAND_BUTTON = /Expand sidebar|展开侧边栏/;
const ANALYTICS_LINK = /Analytics|分析/;

async function focusedInsideMain(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.closest("#main-content") !== null);
}

/**
 * dev server 冷编译时 React 可能尚未 hydration，此时按键/点击不会触发 effect 里的监听器。
 * 所以依赖客户端事件的断言重试的是“动作 + 断言”整体，而不是只重试断言。
 */
async function retry(action: () => Promise<void>, assert: () => Promise<void>) {
  await expect(async () => {
    await action();
    await assert();
  }).toPass({ timeout: 20_000, intervals: [500, 1_000, 2_000] });
}

test.describe("跳转到主内容", () => {
  test.use({ viewport: DESKTOP });

  test("首个 Tab 焦点是跳转链接，激活后焦点进入主内容", async ({ page }) => {
    await page.goto("/");

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: SKIP_LINK });
    await expect(skipLink).toBeFocused();
    // 仅聚焦时可见，未聚焦时是 sr-only
    await expect(skipLink).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();

    // 继续 Tab 应该进入正文，而不是绕回页头
    await page.keyboard.press("Tab");
    expect(await focusedInsideMain(page)).toBe(true);
  });
});

test.describe("移动端页头菜单", () => {
  test.use({ viewport: MOBILE });

  test("Esc 关闭菜单并把焦点交还汉堡按钮", async ({ page }) => {
    await page.goto("/");

    const menuButton = page.locator("header").getByRole("button", { name: MENU_BUTTON });
    await retry(
      () => menuButton.click(),
      () => expect(menuButton).toHaveAttribute("aria-expanded", "true"),
    );
    await expect(page.locator("#site-mobile-menu")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#site-mobile-menu")).toHaveCount(0);
    await expect(menuButton).toBeFocused();
  });

  test("菜单内链接可被 Tab 依次访问", async ({ page }) => {
    await page.goto("/");

    const menuButton = page.locator("header").getByRole("button", { name: MENU_BUTTON });
    await retry(
      () => menuButton.click(),
      () => expect(page.locator("#site-mobile-menu")).toBeVisible(),
    );
    const menu = page.locator("#site-mobile-menu");

    await menu.getByRole("link", { name: /Home|首页/ }).focus();
    await page.keyboard.press("Tab");
    await expect(menu.getByRole("link", { name: /Features|功能/ })).toBeFocused();
  });
});

test.describe("仪表盘侧边栏折叠", () => {
  test.use({ viewport: DESKTOP });

  test("折叠按钮暴露名称与展开状态，折叠后链接仍有可访问名称", async ({ page }) => {
    await page.goto("/dashboard");

    // 折叠按钮的可访问名称会随状态变化，因此用位置稳定的 locator 断言，避免断言期间 locator 失效
    const toggle = page.locator("aside").first().getByRole("button").first();
    await expect(toggle).toHaveAccessibleName(COLLAPSE_BUTTON);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAttribute("aria-controls", "dashboard-sidebar-nav");

    await retry(
      () => toggle.click(),
      () => expect(toggle).toHaveAttribute("aria-expanded", "false"),
    );

    await expect(toggle).toHaveAccessibleName(EXPAND_BUTTON);
    // 折叠后文字隐藏，名称来自 aria-label
    const analytics = page.locator("#dashboard-sidebar-nav").getByRole("link", {
      name: ANALYTICS_LINK,
    });
    await expect(analytics).toHaveAttribute("aria-label", ANALYTICS_LINK);

    // 键盘也能展开回来（Enter 触发按钮）
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAccessibleName(COLLAPSE_BUTTON);
  });
});

test.describe("快捷键帮助对话框", () => {
  test.use({ viewport: DESKTOP });

  test("按 ? 打开，Esc 关闭并归还焦点", async ({ page }) => {
    await page.goto("/");

    await retry(
      () => page.keyboard.press("?"),
      () => expect(page.getByRole("dialog")).toBeVisible(),
    );
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(SHORTCUTS_TITLE)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("header").getByRole("button", { name: SHORTCUTS_BUTTON })).toBeFocused();
  });

  test("命令面板输入框里输入 ? 不弹快捷键帮助", async ({ page }) => {
    await page.goto("/dashboard");

    const paletteInput = page.getByPlaceholder(/Type a command or search|输入命令/);
    await retry(
      () => page.keyboard.press("ControlOrMeta+k"),
      () => expect(paletteInput).toBeVisible(),
    );

    await paletteInput.fill("");
    await page.keyboard.type("?");

    // 只应存在命令面板这一个对话框
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByText(SHORTCUTS_TITLE)).toHaveCount(0);
  });
});
