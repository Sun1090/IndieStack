/**
 * PasswordForm 组件测试
 * 覆盖：渲染、修改成功刷新、失败 toast
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasswordForm } from "./password-form";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const updatePasswordMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/settings", () => ({
  updatePassword: updatePasswordMock,
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PasswordForm", () => {
  it("渲染当前密码与新密码输入", () => {
    render(<PasswordForm />);
    expect(document.getElementById("currentPassword")).toBeInTheDocument();
    expect(document.getElementById("newPassword")).toBeInTheDocument();
  });

  it("提交成功后调用 updatePassword 并 refresh", async () => {
    updatePasswordMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<PasswordForm />);

    await user.type(document.getElementById("currentPassword")!, "old123");
    await user.type(document.getElementById("newPassword")!, "newpass123");
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(updatePasswordMock).toHaveBeenCalledTimes(1);
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("失败时展示 destructive toast 且不 refresh", async () => {
    updatePasswordMock.mockResolvedValue({ ok: false, error: "currentPasswordIncorrect" });
    const user = userEvent.setup();
    render(<PasswordForm />);

    await user.type(document.getElementById("currentPassword")!, "wrong");
    await user.type(document.getElementById("newPassword")!, "newpass123");
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
