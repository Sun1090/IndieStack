/**
 * PageLoading / LoadingIndicator 组件测试（G04）
 * 覆盖：骨架变体形状、aria-busy + role=status、i18n 文案与覆盖、局部指示器
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageLoading, LoadingIndicator } from "./page-loading";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}));

describe("PageLoading", () => {
  it("默认骨架屏带 aria-busy 与 role=status，文案走 i18n", () => {
    const { container } = render(<PageLoading />);

    expect(screen.getByRole("status")).toHaveTextContent("t:loading");
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
    // 标题两行 + 4 张统计卡 + 一块内容区
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(7);
  });

  it("list 变体按 rows 渲染占位行", () => {
    const { container } = render(<PageLoading variant="list" rows={3} />);

    expect(container.querySelectorAll(".h-20.w-full")).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("t:loading");
  });

  it("label 覆盖默认加载文案", () => {
    render(<PageLoading variant="dashboard" label="正在加载仪表盘" />);

    expect(screen.getByRole("status")).toHaveTextContent("正在加载仪表盘");
  });

  it("spinner 变体渲染局部指示器而非骨架屏", () => {
    const { container } = render(<PageLoading variant="spinner" label="跳转中" />);

    expect(screen.getByRole("status")).toHaveTextContent("跳转中");
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
  });
});

describe("LoadingIndicator", () => {
  it("以 role=status 暴露文本，spinner 对屏幕阅读器隐藏", () => {
    const { container } = render(<LoadingIndicator label="加载中" />);

    expect(screen.getByRole("status")).toHaveTextContent("加载中");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
