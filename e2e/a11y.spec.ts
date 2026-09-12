import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const publicPages = [
  { path: "/", name: "首页" },
  { path: "/features", name: "功能页" },
  { path: "/pricing", name: "定价页" },
  { path: "/auth/login", name: "登录页" },
  { path: "/auth/register", name: "注册页" },
];

for (const pageInfo of publicPages) {
  test(`${pageInfo.name}通过 WCAG 2.1 A/AA 自动审计`, async ({ page }) => {
    await page.goto(pageInfo.path);
    await expect(page.locator("#main-content")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(
      results.violations,
      results.violations
        .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`)
        .join("\n"),
    ).toEqual([]);
  });
}
