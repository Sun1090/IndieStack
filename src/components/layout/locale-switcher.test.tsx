/**
 * LocaleSwitcher 组件测试
 * 覆盖：菜单渲染、当前语言加粗、切换写入 Cookie 并刷新页面
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleSwitcher } from "./locale-switcher";

vi.mock("next-intl", () => ({
  useLocale: () => "zh-CN",
}));

const reloadMock = vi.hoisted(() => vi.fn());
beforeEach(() => {
  vi.clearAllMocks();
  document.cookie = "app-locale=; max-age=0";
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...window.location, reload: reloadMock },
  });
});

describe("LocaleSwitcher", () => {
  it("渲染语言菜单并标记当前语言为粗体", async () => {
    const user = userEvent.setup();
    render(<LocaleSwitcher />);

    await user.click(screen.getByRole("button"));
    const zhItem = await screen.findByRole("menuitem", { name: /简体中文/ });
    const enItem = screen.getByRole("menuitem", { name: /English/ });

    expect(zhItem).toHaveClass("font-bold");
    expect(enItem).not.toHaveClass("font-bold");
  });

  it("点击 English 写入 Cookie 并触发刷新", async () => {
    const user = userEvent.setup();
    render(<LocaleSwitcher />);

    await user.click(screen.getByRole("button"));
    await user.click(screen.getByRole("menuitem", { name: /English/ }));

    expect(document.cookie).toContain("app-locale=en");
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
