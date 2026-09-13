import { expect, test, type Page } from "@playwright/test";
import { THEME_STORAGE_KEY } from "../src/lib/theme/theme";

/**
 * G05 暗色模式回归。
 *
 * 覆盖两类此前没有断言的行为：
 * 1. 首屏（hydration 之前）就应用已保存/系统偏好主题——阻断客户端 bundle 后仍然生效，
 *    证明主题不是靠 React 挂载后才切换（那会先闪一帧浅色）。
 * 2. 运行期切换：按钮写 localStorage 并立刻改变 html class；系统模式下跟随
 *    prefers-color-scheme 变化。
 */

const THEME_KEY = THEME_STORAGE_KEY;

/** 阻断 Next.js 客户端 bundle：只保留服务端 HTML 与内联脚本，等价于 hydration 之前。 */
async function blockHydration(page: Page) {
  await page.route("**/_next/static/**", (route) => route.abort());
}

test.describe("主题首屏（hydration 之前）", () => {
  test("localStorage=dark 时 html 直接带 dark，不依赖 React", async ({ page, context }) => {
    await context.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [THEME_KEY, "dark"],
    );
    await blockHydration(page);

    await page.goto("/", { waitUntil: "commit" });
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  });

  test("localStorage=light 时不带 dark", async ({ page, context }) => {
    await context.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [THEME_KEY, "light"],
    );
    await blockHydration(page);

    await page.goto("/", { waitUntil: "commit" });
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  });

  test.describe("系统偏好为深色", () => {
    test.use({ colorScheme: "dark" });

    test("localStorage 为 system 时跟随系统使用 dark", async ({ page, context }) => {
      await context.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [THEME_KEY, "system"],
      );
      await blockHydration(page);

      await page.goto("/", { waitUntil: "commit" });
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    });

    test("没有保存过主题时默认 system，同样使用 dark", async ({ page }) => {
      await blockHydration(page);
      await page.goto("/", { waitUntil: "commit" });
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    });
  });
});

test.describe("主题切换与持久化", () => {
  test("按钮切换主题、持久化并同步 color-scheme", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const toggle = page.getByRole("button", { name: "Toggle theme" });
    await expect(toggle).toBeVisible();

    // 固定到浅色（不依赖运行环境默认值）
    await page.evaluate((key) => window.localStorage.setItem(key, "light"), THEME_KEY);
    await page.reload();
    await expect(html).not.toHaveClass(/\bdark\b/);

    await toggle.click();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(html).toHaveCSS("color-scheme", "dark");
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY))
      .toBe("dark");

    await toggle.click();
    await expect(html).not.toHaveClass(/\bdark\b/);
    await expect(html).toHaveCSS("color-scheme", "light");
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY))
      .toBe("light");
  });

  test("重新加载后保持已保存的主题", async ({ page, context }) => {
    await context.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [THEME_KEY, "dark"],
    );
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  });
});
