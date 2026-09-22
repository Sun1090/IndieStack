import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./support/base-url";

/**
 * G06 移动端断点回归。
 *
 * 覆盖三档视口（375 手机 / 768 平板 / 1280 桌面）下的真实布局行为：
 * 1. 顶部导航在断点两侧切换汉堡菜单与桌面链接，且汉堡菜单可开可跳转；
 * 2. 仪表盘侧边栏在 <768px 不能"整体消失"——必须有可达的导航入口；
 * 3. 公共页与仪表盘在窄视口下不出现横向溢出（scrollWidth > innerWidth）。
 *
 * 断点取值来自 Tailwind 默认值：sm=640 / md=768 / lg=1024 / xl=1280。
 */

const MOBILE = { width: 375, height: 812 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 800 };

const MARKETING_PAGES = ["/", "/features", "/pricing"];
const NAV_LINK_NAME = /Pricing|定价/;
const SITE_MENU_BUTTON = /^菜单$|^Menu$/;
const DASHBOARD_MENU_BUTTON = /Dashboard menu|仪表盘菜单/;

/** 横向溢出检测：允许 1px 亚像素误差，失败时列出越界元素便于定位 */
async function expectNoHorizontalOverflow(page: Page, label = "") {
  const { scrollWidth, innerWidth, offenders } = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.right > window.innerWidth + 1) {
        const cls =
          typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 3).join(".") : "";
        out.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}@${Math.round(rect.right)}`);
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      offenders: out.slice(0, 10),
    };
  });

  expect(
    scrollWidth,
    `${label} 横向溢出：scrollWidth=${scrollWidth} > innerWidth=${innerWidth}；越界元素：${offenders.join(", ") || "（无，可能来自滚动容器）"}`,
  ).toBeLessThanOrEqual(innerWidth + 1);
}

test.describe("视口元信息", () => {
  test("移动端声明 device-width", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${appUrl()}/`);

    const content = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(content).toContain("width=device-width");
  });
});

test.describe("手机（375px）", () => {
  test.use({ viewport: MOBILE });

  test("顶部导航折叠为汉堡菜单，展开后可跳转", async ({ page }) => {
    await page.goto(`${appUrl()}/`);

    const menuButton = page.locator("header").getByRole("button", { name: SITE_MENU_BUTTON });
    await expect(menuButton).toBeVisible();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    // 桌面链接在手机端不可见
    await expect(page.locator("header nav").first()).toBeHidden();

    await menuButton.click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");

    const mobileMenu = page.locator("#site-mobile-menu");
    await expect(mobileMenu).toBeVisible();

    const pricing = mobileMenu.getByRole("link", { name: NAV_LINK_NAME });
    await expect(pricing).toBeVisible();
    await pricing.click();

    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.locator("#site-mobile-menu")).toHaveCount(0);
  });

  for (const path of MARKETING_PAGES) {
    test(`${path} 无横向溢出`, async ({ page }) => {
      await page.goto(path);
      await expectNoHorizontalOverflow(page, path);
    });
  }

  test("仪表盘保留可达的移动端导航", async ({ page }) => {
    await page.goto(`${appUrl()}/dashboard`);
    await expect(page.locator("aside").first()).toBeHidden();

    const trigger = page.getByRole("button", { name: DASHBOARD_MENU_BUTTON });
    await expect(trigger).toBeVisible();

    await trigger.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();

    const analytics = drawer.getByRole("link", { name: /Analytics|分析/ });
    await expect(analytics).toBeVisible();
    await analytics.click();

    await expect(page).toHaveURL(/\/dashboard\/analytics$/);
    await expect(drawer).toBeHidden();
  });

  test("仪表盘无横向溢出", async ({ page }) => {
    await page.goto(`${appUrl()}/dashboard`);
    await expectNoHorizontalOverflow(page, "/dashboard");
  });
});

test.describe("平板（768px）", () => {
  test.use({ viewport: TABLET });

  test("改用汉堡菜单避免页头挤压，且不溢出", async ({ page }) => {
    await page.goto(`${appUrl()}/`);

    await expect(page.locator("header nav").first()).toBeHidden();
    await expect(
      page.locator("header").getByRole("button", { name: SITE_MENU_BUTTON }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, "/ @768");
  });

  test("仪表盘侧边栏可见且无溢出", async ({ page }) => {
    await page.goto(`${appUrl()}/dashboard`);

    await expect(page.locator("aside").first()).toBeVisible();
    await expectNoHorizontalOverflow(page, "/dashboard @768");
  });
});

test.describe("桌面（1280px）", () => {
  test.use({ viewport: DESKTOP });

  test("公共页展示完整导航且不溢出", async ({ page }) => {
    await page.goto(`${appUrl()}/`);

    const nav = page.locator("header nav").first();
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: NAV_LINK_NAME })).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(6);
    await expect(
      page.locator("header").getByRole("button", { name: SITE_MENU_BUTTON }),
    ).toBeHidden();
    await expectNoHorizontalOverflow(page, "/ @1280");
  });

  test("仪表盘侧边栏保持展开宽度", async ({ page }) => {
    await page.goto(`${appUrl()}/dashboard`);

    const sidebar = page.locator("aside").first();
    await expect(sidebar).toBeVisible();
    const width = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(200);
  });
});
