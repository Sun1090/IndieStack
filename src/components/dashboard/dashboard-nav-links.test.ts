/**
 * dashboard-nav-links 单元测试（G06）
 * 锁定桌面侧边栏与移动端抽屉共用的导航定义：链接数量、ROUTES 引用、通知判定。
 * 一旦有人只改一侧（例如硬编码 href 或删掉某个入口），这里会先失败。
 */
import { describe, expect, it } from "vitest";
import { ROUTES } from "@/lib/constants";
import {
  ADMIN_NAV_LINK,
  buildDashboardNavLinks,
  isNotificationsLink,
} from "./dashboard-nav-links";

/** 把 key 原样返回，方便断言 label 来自哪个翻译 key */
const t = (key: string) => key;

describe("buildDashboardNavLinks", () => {
  it("返回 10 个仪表盘入口，顺序稳定", () => {
    const links = buildDashboardNavLinks(t);
    expect(links.map((link) => link.href)).toEqual([
      ROUTES.dashboard,
      ROUTES.dashboardAnalytics,
      ROUTES.dashboardProjects,
      ROUTES.dashboardProfile,
      ROUTES.dashboardTeam,
      ROUTES.dashboardBilling,
      ROUTES.apiKeys,
      ROUTES.dashboardSettings,
      ROUTES.dashboardNotifications,
      ROUTES.dashboardIntegrations,
    ]);
  });

  it("每个链接都有 label 与图标组件", () => {
    for (const link of buildDashboardNavLinks(t)) {
      expect(link.label).toBeTruthy();
      expect(link.icon).toBeTruthy();
    }
  });

  it("label 通过传入的 t 解析（i18n 生效）", () => {
    const links = buildDashboardNavLinks(t);
    expect(links.find((link) => link.href === ROUTES.dashboard)?.label).toBe("dashboard");
    expect(links.find((link) => link.href === ROUTES.dashboardNotifications)?.label).toBe(
      "notifications",
    );
  });

  it("href 全部来自 ROUTES，没有硬编码字符串", () => {
    const known = new Set<string>(Object.values(ROUTES));
    for (const link of buildDashboardNavLinks(t)) {
      expect(known.has(link.href)).toBe(true);
      expect(link.href.startsWith("/dashboard") || link.href === ROUTES.apiKeys).toBe(true);
    }
  });

  it("ADMIN_NAV_LINK 指向 ROUTES.admin", () => {
    expect(ADMIN_NAV_LINK.href).toBe(ROUTES.admin);
    expect(ADMIN_NAV_LINK.icon).toBeTruthy();
  });
});

describe("isNotificationsLink", () => {
  it("仅对通知路由返回 true", () => {
    expect(isNotificationsLink(ROUTES.dashboardNotifications)).toBe(true);
    expect(isNotificationsLink(ROUTES.dashboard)).toBe(false);
    expect(isNotificationsLink(ROUTES.dashboardSettings)).toBe(false);
    // 前缀相近但不同的路径不应误判
    expect(isNotificationsLink(`${ROUTES.dashboardNotifications}/123`)).toBe(false);
  });
});
