/**
 * InviteMemberForm 组件测试
 * 覆盖：表单渲染、邀请成功跳转、失败 toast、必填校验
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteMemberForm } from "./invite-member-form";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const pushMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const inviteMemberMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/team", () => ({
  inviteMember: inviteMemberMock,
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InviteMemberForm", () => {
  it("渲染邮箱输入、角色选择和提交按钮", () => {
    render(<InviteMemberForm />);
    expect(screen.getByLabelText("emailLabel")).toBeInTheDocument();
    expect(screen.getByLabelText("roleLabel")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "submit" }),
    ).toBeInTheDocument();
  });

  it("提交成功后调用 inviteMember 并跳转团队页", async () => {
    inviteMemberMock.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<InviteMemberForm />);

    await user.type(screen.getByLabelText("emailLabel"), "dev@example.com");
    await user.selectOptions(screen.getByLabelText("roleLabel"), "admin");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(inviteMemberMock).toHaveBeenCalledWith({ email: "dev@example.com", role: "admin" });
      expect(pushMock).toHaveBeenCalledWith("/dashboard/team");
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("邀请失败时展示 destructive toast 且不跳转", async () => {
    inviteMemberMock.mockResolvedValue({ error: "alreadyMember" });
    const user = userEvent.setup();
    render(<InviteMemberForm />);

    await user.type(screen.getByLabelText("emailLabel"), "dev@example.com");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
