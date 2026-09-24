/**
 * SiteHeader 组件测试（G07 / C09）
 * 覆盖：移动端菜单按钮的可访问名称与展开状态、菜单 id 关联、Esc 关闭并归还焦点；
 *       以及「退出登录」在没退成的时候不许报告已登出。
 * 背景：移动端菜单原先只能靠再次点击按钮关闭，键盘用户按 Esc 无反应且焦点留在原地。
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./site-header";
import { ROUTES } from "@/lib/constants";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const pushMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const userMocks = vi.hoisted(() => ({
  value: { user: null as { email?: string } | null, loading: false },
}));

vi.mock("@/hooks/use-user", () => ({
  useUser: () => userMocks.value,
}));

const signOutMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: signOutMock } }),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));

// Radix 的下拉需要 ResizeObserver，jsdom 里没有；这里换成普通元素，
// 被测的是「退出这一步失败时组件做了什么」，不是下拉的展开实现。
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="menu-content">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
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
  vi.clearAllMocks();
  userMocks.value = { user: null, loading: false };
  signOutMock.mockResolvedValue({ error: null });
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

describe("SiteHeader 退出登录（C09）", () => {
  beforeEach(() => {
    userMocks.value = { user: { email: "a@b.com" }, loading: false };
  });

  it("signOut 返回 error 时给可重试的提示，并且不跳转、不刷新", async () => {
    signOutMock.mockResolvedValue({ error: { message: "network hiccup" } });
    const user = userEvent.setup();
    render(<SiteHeader />);

    await user.click(screen.getByRole("button", { name: "signOut" }));

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", description: "signOutFailed" }),
    );
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("只有真退出了才跳首页并刷新", async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);

    await user.click(screen.getByRole("button", { name: "signOut" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(ROUTES.home));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(toastMock).not.toHaveBeenCalled();
  });
});
