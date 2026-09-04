/**
 * PasswordStrength 组件测试（C05 测试职责）
 * 覆盖：空密码不渲染、评分函数分支、强度条数量、标签 i18n key
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PasswordStrength, scorePassword } from "./password-strength";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("scorePassword()", () => {
  it("空密码 0 分", () => {
    expect(scorePassword("")).toBe(0);
  });

  it("弱密码 1 分", () => {
    expect(scorePassword("abcdefgh")).toBe(1);
  });

  it("长度 + 大小写 + 数字 + 符号满分", () => {
    expect(scorePassword("Abcdef123456!@#")).toBe(4);
  });

  it("不足 8 位扣分", () => {
    expect(scorePassword("Ab1!")).toBeLessThan(4);
  });
});

describe("PasswordStrength", () => {
  it("空密码渲染 null", () => {
    const { container } = render(<PasswordStrength password="" />);
    expect(container.firstChild).toBeNull();
  });

  it("渲染 4 格强度条与翻译标签", () => {
    const { container } = render(<PasswordStrength password="Abcdef123456!@#" />);
    expect(container.querySelectorAll(".flex-1")).toHaveLength(4);
    expect(screen.getByText("strength.strong")).toBeInTheDocument();
  });

  it("弱密码显示 weak 标签", () => {
    render(<PasswordStrength password="abcdefgh" />);
    expect(screen.getByText("strength.weak")).toBeInTheDocument();
  });
});
