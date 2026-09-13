/**
 * NativeSelect 控件测试
 * 覆盖：选项渲染、默认外观类、外部 className 合并、disabled/aria 透传、ref 转发
 */
import { describe, it, expect } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { NativeSelect, NATIVE_SELECT_CLASSES } from "./native-select";

describe("NativeSelect", () => {
  it("渲染选项并合并外部 className", () => {
    render(
      <NativeSelect data-testid="timezone" className="max-w-xs" defaultValue="UTC">
        <option value="UTC">UTC</option>
        <option value="Asia/Shanghai">Asia/Shanghai</option>
      </NativeSelect>,
    );

    const select = screen.getByTestId("timezone");
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveClass("max-w-xs");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(select).toHaveValue("UTC");
  });

  it("默认外观包含 disabled 与 focus-visible 变体", () => {
    for (const expected of [
      "disabled:cursor-not-allowed",
      "disabled:opacity-50",
      "focus-visible:ring-2",
      "focus-visible:outline-hidden",
    ]) {
      expect(NATIVE_SELECT_CLASSES).toContain(expected);
    }
  });

  it("透传 disabled 与 aria 属性并转发 ref", () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <NativeSelect ref={ref} disabled aria-invalid="true" data-testid="role">
        <option value="member">member</option>
      </NativeSelect>,
    );

    const select = screen.getByTestId("role");
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(ref.current).toBe(select);
  });
});
