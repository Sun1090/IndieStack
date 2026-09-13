/**
 * SiteHeader 组件测试（G07）
 * 覆盖：移动端菜单按钮的可访问名称与展开状态、菜单 id 关联、Esc 关闭并归还焦点。
 * 背景：移动端菜单原先只能靠再次点击按钮关闭，键盘用户按 Esc 无反应且焦点留在原地。
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./site-header";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const userMocks = vi.hoisted(() => ({
  value: { user: null as { email?: string } | null, loading: false },
}));

vi.mock("@/hooks/use-user", () => ({
  useUser: () => userMocks.value,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

vi.mock("@/components/layout/theme-toggle", () => ({
  ThemeToggle: () => <span data-testid="theme-toggle" />,
}));

vi.mock("@/components/layout/locale-switcher", () => ({
  LocaleSwitcher: () => <span data-testid="locale-switcher" />,
}));

vi.mock("@/components/layout/shortcuts-dialog", () => ({
  ShortcutsDialog: () => <span data-testid="shortcuts" />,
}));

beforeEach(() => {
  userMocks.value = { user: null, loading: false };
});

describe("SiteHeader 移动端菜单", () => {
  it("按钮有可访问名称、aria-expanded 与 aria-controls 关联", () => {
    render(<SiteHeader />);

    const toggle = screen.getByRole("button", { name: "menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "site-mobile-menu");
    expect(document.getElementById("site-mobile-menu")).toBeNull();
  });

  it("点击展开菜单并更新 aria-expanded", async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);

    await user.click(screen.getByRole("button", { name: "menu" }));

    expect(screen.getByRole("button", { name: "menu" })).toHaveAttribute("aria-expanded", "true");
    const menu = document.getElementById("site-mobile-menu");
    expect(menu).not.toBeNull();
    // 桌面导航在 jsdom 里同样渲染（CSS 断点不生效），断言必须限定在移动菜单容器内
    const inMenu = within(menu as HTMLElement);
    expect(inMenu.getByRole("link", { name: "home" })).toHaveAttribute("href", "/");
    expect(inMenu.getByRole("link", { name: "features" })).toHaveAttribute("href", "/features");
  });

  it("Esc 关闭菜单并把焦点还给切换按钮", async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);
    const toggle = screen.getByRole("button", { name: "menu" });

    await user.click(toggle);
    await waitFor(() => expect(document.getElementById("site-mobile-menu")).not.toBeNull());

    await user.keyboard("{Escape}");

    await waitFor(() => expect(document.getElementById("site-mobile-menu")).toBeNull());
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("未登录时移动菜单提供登录/注册入口", async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);

    await user.click(screen.getByRole("button", { name: "menu" }));

    const menu = document.getElementById("site-mobile-menu");
    expect(menu?.querySelector('a[href="/auth/login"]')).not.toBeNull();
    expect(menu?.querySelector('a[href="/auth/register"]')).not.toBeNull();
  });
});
