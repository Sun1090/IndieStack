import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InitialAvatar } from "./initial-avatar";

describe("InitialAvatar", () => {
  it("英文名取首字母大写", () => {
    render(<InitialAvatar name="alice smith" />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("邮箱取首字符", () => {
    render(<InitialAvatar name="dev@example.com" />);
    expect(screen.getByText("D")).toBeInTheDocument();
  });

  it("中文名取首字", () => {
    render(<InitialAvatar name="张三" />);
    expect(screen.getByText("张")).toBeInTheDocument();
  });

  it("空值显示问号", () => {
    render(<InitialAvatar name="" />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("同名输入颜色稳定（哈希确定性）", () => {
    const { container: c1 } = render(<InitialAvatar name="bob" />);
    const { container: c2 } = render(<InitialAvatar name="bob" />);
    expect(c1.firstElementChild?.className).toBe(c2.firstElementChild?.className);
  });
});
