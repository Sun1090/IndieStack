/**
 * QueryErrorState 组件测试
 * 覆盖：默认文案、自定义文案、重试回调、className 透传
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryErrorState } from "./query-error-state";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}));

describe("QueryErrorState", () => {
  it("默认展示通用错误文案与重试按钮", () => {
    render(<QueryErrorState onRetry={vi.fn()} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("t:error");
    expect(alert.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "t:retry" })).toBeInTheDocument();
  });

  it("点击重试触发 onRetry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<QueryErrorState onRetry={onRetry} />);

    await user.click(screen.getByRole("button", { name: "t:retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("自定义文案与 className 生效", () => {
    const { container } = render(
      <QueryErrorState onRetry={vi.fn()} message="统计接口暂时不可用" className="h-[300px]" />,
    );

    expect(screen.getByText("统计接口暂时不可用")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("h-[300px]");
  });
});
