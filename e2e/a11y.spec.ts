/**
 * 无障碍运行时审计（D10 / axe）。
 *
 * 此前只扫 5 个公共页，从不进入仪表盘——于是 3 个没有任何可访问名称的 `size="icon"` 按钮
 * （admin 用户表改角色触发器、新建项目与新建团队的返回按钮）同时躲过了静态门禁
 * （`check:a11y` 那条规则恒不触发，见 `src/lib/ui/a11y-rules.ts`）和这道运行时门禁。
 * axe 的 `button-name` 规则本来抓得到它们，缺的只是**覆盖面**，所以这里把仪表盘补进来，
 * 且刻意包含那三个页面本身，作为「门禁能失败」的活证据。
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./support/base-url";

/** mock 模式下默认 profile 是 super_admin，可进入 admin 专属页。 */
const MOCK_EMAIL = "dev@indiestack.local";
const MOCK_PASSWORD = "password123";

const publicPages = [
  { path: "/", name: "首页" },
  { path: "/features", name: "功能页" },
  { path: "/pricing", name: "定价页" },
  { path: "/auth/login", name: "登录页" },
  { path: "/auth/register", name: "注册页" },
];

const authedPages = [
  { path: "/dashboard", name: "仪表盘概览" },
  { path: "/dashboard/projects", name: "项目列表" },
  // 以下三页各自带着一个曾被两道门禁同时漏过的图标按钮
  { path: "/dashboard/projects/new", name: "新建项目（返回按钮）" },
  { path: "/dashboard/team/create", name: "创建团队（返回按钮）" },
  { path: "/dashboard/admin/users", name: "用户管理（改角色触发器）" },
  { path: "/dashboard/team", name: "团队列表" },
  { path: "/dashboard/settings", name: "账户设置" },
  { path: "/dashboard/notifications", name: "通知列表" },
  { path: "/dashboard/api-keys", name: "API 密钥" },
];

async function loginAsMockUser(page: Page): Promise<void> {
  await page.goto(`${appUrl()}/auth/login`, { timeout: 60_000 });
  await page.locator("input[type=email]").first().fill(MOCK_EMAIL);
  await page.locator("input[type=password]").first().fill(MOCK_PASSWORD);
  await page.getByRole("button", { name: /sign in|登录/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
}

/** 跑一次 WCAG 2.1 A/AA 审计并把违规渲染成可读的失败信息。 */
async function expectNoA11yViolations(page: Page, name: string): Promise<void> {
  await expect(page.locator("#main-content")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(
    results.violations,
    `${name}：\n` +
      results.violations
        .map(
          (violation) =>
            `  ${violation.id}: ${violation.help} (${violation.nodes.length} nodes)\n` +
            violation.nodes
              .slice(0, 3)
              .map((node) => `    - ${node.target.join(" ")}`)
              .join("\n"),
        )
        .join("\n"),
  ).toEqual([]);
}

for (const pageInfo of publicPages) {
  test(`${pageInfo.name}通过 WCAG 2.1 A/AA 自动审计`, async ({ page }) => {
    await page.goto(`${appUrl()}${pageInfo.path}`);
    await expectNoA11yViolations(page, pageInfo.name);
  });
}

test.describe("已认证仪表盘页", () => {
  test.describe.configure({ mode: "serial" });

  for (const pageInfo of authedPages) {
    test(`${pageInfo.name}通过 WCAG 2.1 A/AA 自动审计`, async ({ page }) => {
      await loginAsMockUser(page);
      await page.goto(`${appUrl()}${pageInfo.path}`, { timeout: 60_000 });
      await expectNoA11yViolations(page, pageInfo.name);
    });
  }
});
