/**
 * MobileDashboardNav 组件测试（G06）
 * 覆盖：默认关闭、可访问名称、点击展开、渲染全部导航入口、管理员入口、未读 badge、路由变化自动关闭。
 * 背景：手机端侧边栏此前完全隐藏，导航不可达；这个组件是移动端唯一入口，回归成本高。
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTES } from "@/lib/constants";
import { MobileDashboardNav } from "./mobile-dashboard-nav";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const navMocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  isAdmin: false,
  unread: 0,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navMocks.pathname,
}));

vi.mock("@/hooks/use-is-admin", () => ({
  useIsAdmin: () => navMocks.isAdmin,
}));

vi.mock("@/hooks/use-unread-notifications", () => ({
  useUnreadNotificationCount: () => navMocks.unread,
}));

beforeEach(() => {
  navMocks.pathname = "/dashboard";
  navMocks.isAdmin = false;
  navMocks.unread = 0;
});

describe("MobileDashboardNav", () => {
  it("默认关闭，只显示带可访问名称的菜单按钮", () => {
    render(<MobileDashboardNav />);
    const trigger = screen.getByRole("button", { name: "dashboardMenu" });
    expect(trigger).toHaveAttribute("aria-label", "dashboardMenu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // 抽屉未打开时不应出现导航链接
    expect(screen.queryByRole("link", { name: /analytics/ })).not.toBeInTheDocument();
  });

  it("点击后展开抽屉并渲染全部导航入口", async () => {
    const user = userEvent.setup();
    render(<MobileDashboardNav />);

    await user.click(screen.getByRole("button", { name: "dashboardMenu" }));

    const nav = await screen.findByRole("navigation", { name: "dashboard" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
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

  it("当前路径的链接标记 aria-current=page", async () => {
    navMocks.pathname = ROUTES.dashboardAnalytics;
    const user = userEvent.setup();
    render(<MobileDashboardNav />);

    await user.click(screen.getByRole("button", { name: "dashboardMenu" }));

    const active = await screen.findByRole("link", { name: "analytics" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "settings" })).not.toHaveAttribute("aria-current");
  });

  it("管理员额外看到管理后台入口", async () => {
    navMocks.isAdmin = true;
    const user = userEvent.setup();
    render(<MobileDashboardNav />);

    await user.click(screen.getByRole("button", { name: "dashboardMenu" }));

    const admin = await screen.findByRole("link", { name: "admin" });
    expect(admin).toHaveAttribute("href", ROUTES.admin);
  });

  it("非管理员不渲染管理后台入口", async () => {
    const user = userEvent.setup();
    render(<MobileDashboardNav />);

    await user.click(screen.getByRole("button", { name: "dashboardMenu" }));
    await screen.findByRole("navigation", { name: "dashboard" });

    expect(screen.queryByRole("link", { name: "admin" })).not.toBeInTheDocument();
  });

  it("有未读通知时在通知入口显示 badge，超过 99 显示 99+", async () => {
    navMocks.unread = 120;
    const user = userEvent.setup();
    const { rerender } = render(<MobileDashboardNav />);

    await user.click(screen.getByRole("button", { name: "dashboardMenu" }));

    const notifications = await screen.findByRole("link", { name: /notifications/ });
    expect(notifications).toHaveTextContent("99+");

    navMocks.unread = 3;
    rerender(<MobileDashboardNav />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /notifications/ })).toHaveTextContent("3");
    });
  });

  it("未读为 0 时不渲染 badge", async () => {
    const user = userEvent.setup();
    render(<MobileDashboardNav />);

    await user.click(screen.getByRole("button", { name: "dashboardMenu" }));

    const notifications = await screen.findByRole("link", { name: "notifications" });
    expect(notifications).toHaveTextContent(/^notifications$/);
  });

  it("路由变化后自动关闭抽屉", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MobileDashboardNav />);

    await user.click(screen.getByRole("button", { name: "dashboardMenu" }));
    await screen.findByRole("navigation", { name: "dashboard" });

    navMocks.pathname = ROUTES.dashboardSettings;
    rerender(<MobileDashboardNav />);

    await waitFor(() => {
      expect(screen.queryByRole("navigation", { name: "dashboard" })).not.toBeInTheDocument();
    });
  });
});
