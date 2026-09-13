/**
 * EmptyState 组件测试
 * 覆盖：role=status、图标 aria-hidden、标题/描述/操作渲染、className 合并
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("以 role=status 暴露空态标题，图标对屏幕阅读器隐藏", () => {
    const { container } = render(<EmptyState icon={Inbox} title="暂无项目" />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("暂无项目");
    expect(status.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("渲染描述与操作节点", () => {
    render(
      <EmptyState
        icon={Inbox}
        title="暂无项目"
        description="创建第一个项目开始使用"
        action={<button>新建项目</button>}
      />,
    );

    expect(screen.getByText("创建第一个项目开始使用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建项目" })).toBeInTheDocument();
  });

  it("无描述时不渲染描述段落，并合并外部 className", () => {
    const { container } = render(
      <EmptyState icon={Inbox} title="暂无数据" className="col-span-full" />,
    );

    expect(container.firstElementChild).toHaveClass("col-span-full");
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});
