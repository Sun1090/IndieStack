/**
 * ErrorState 组件测试
 * 覆盖：默认 alert 角色、状态码 h1、标题/描述/操作渲染、自定义图标与 role
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileWarning, RefreshCw } from "lucide-react";
import { ErrorState } from "./error-state";

describe("ErrorState", () => {
  it("默认以 role=alert 暴露错误并渲染标题与说明", () => {
    render(<ErrorState title="出错了" description="请稍后重试" />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("出错了");
    expect(alert).toHaveTextContent("请稍后重试");
    expect(alert.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("传入 code 时渲染唯一 h1，并可自定义图标与 role", () => {
    render(<ErrorState code="404" icon={FileWarning} role="status" title="页面未找到" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("404");
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("渲染操作区并可覆盖内边距", () => {
    const { container } = render(
      <ErrorState
        title="加载失败"
        size="page"
        className="min-h-screen"
        action={
          <button>
            <RefreshCw aria-hidden="true" /> 重试
          </button>
        }
      />,
    );

    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
    const root = container.firstElementChild;
    expect(root).toHaveClass("min-h-screen");
    // twMerge：外部 min-h 覆盖 size=page 的默认最小高度
    expect(root?.className).not.toContain("min-h-[50vh]");
  });
});
