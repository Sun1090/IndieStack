/**
 * ThemeToggle 组件测试
 * 覆盖：light→dark 切换、dark→light 反向切换
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "./theme-toggle";

const setThemeMock = vi.hoisted(() => vi.fn());
let mockTheme = "light";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/providers/theme-provider", () => ({
  useTheme: () => ({ theme: mockTheme, setTheme: setThemeMock }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockTheme = "light";
});

describe("ThemeToggle", () => {
  it("当前 light 时点击切到 dark", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button"));
    expect(setThemeMock).toHaveBeenCalledWith("dark");
  });

  it("当前 dark 时点击切到 light", async () => {
    mockTheme = "dark";
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button"));
    expect(setThemeMock).toHaveBeenCalledWith("light");
  });
});
