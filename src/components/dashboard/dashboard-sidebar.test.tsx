/**
 * DashboardSidebar 组件测试（G06）
 * 覆盖：链接来自共享定义（与移动端抽屉一致）、管理员入口、折叠交互、aria-current 标记。
 * 目的：防止桌面侧边栏与移动端抽屉的导航定义再次分叉。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTES } from "@/lib/constants";
import { buildDashboardNavLinks } from "./dashboard-nav-links";
import { DashboardSidebar } from "./dashboard-sidebar";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const sidebarMocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  isAdmin: false,
  unread: 0,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => sidebarMocks.pathname,
}));

vi.mock("@/hooks/use-is-admin", () => ({
  useIsAdmin: () => sidebarMocks.isAdmin,
}));

vi.mock("@/hooks/use-unread-notifications", () => ({
  useUnreadNotificationCount: () => sidebarMocks.unread,
}));

beforeEach(() => {
  sidebarMocks.pathname = "/dashboard";
  sidebarMocks.isAdmin = false;
  sidebarMocks.unread = 0;
});

describe("DashboardSidebar", () => {
  it("渲染共享定义中的全部导航入口（与移动端一致）", () => {
    render(<DashboardSidebar />);
    const expected = buildDashboardNavLinks((key) => key).map((link) => link.href);
    const hrefs = Array.from(screen.getByRole("complementary").querySelectorAll("nav a")).map(
      (a) => a.getAttribute("href"),
    );
    expect(hrefs).toEqual(expected);
  });

  it("当前页标记 aria-current=page", () => {
    sidebarMocks.pathname = ROUTES.dashboardTeam;
    render(<DashboardSidebar />);
    expect(screen.getByRole("link", { name: "team" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "billing" })).not.toHaveAttribute("aria-current");
  });

  it("管理员看到管理后台入口", () => {
    sidebarMocks.isAdmin = true;
    render(<DashboardSidebar />);
    expect(screen.getByRole("link", { name: "admin" })).toHaveAttribute("href", ROUTES.admin);
  });

  it("折叠后隐藏文字标签且保留链接", async () => {
    const user = userEvent.setup();
    render(<DashboardSidebar />);

    expect(screen.getByText("analytics")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button")[0]);

    expect(screen.queryByText("analytics")).not.toBeInTheDocument();
    expect(screen.getByRole("complementary").querySelectorAll("nav a")).toHaveLength(
      buildDashboardNavLinks((key) => key).length,
    );
  });
});
