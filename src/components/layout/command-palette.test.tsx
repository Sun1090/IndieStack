/**
 * CommandPalette 组件测试
 * 覆盖：⌘K 打开、搜索过滤、选中跳转、Esc 关闭
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./command-palette";

const pushMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CommandPalette", () => {
  it("默认关闭，⌘K 打开", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("输入过滤导航项并选中跳转", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.keyboard("{Meta>}k{/Meta}");

    const input = await screen.findByPlaceholderText("commandPalette.placeholder");
    await user.type(input, "apiKeys");

    const item = await screen.findByText("apiKeys");
    await user.click(item);
    expect(pushMock).toHaveBeenCalledWith("/dashboard/api-keys");
  });

  it("Esc 关闭面板", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
