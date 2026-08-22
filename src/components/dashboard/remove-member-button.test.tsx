/**
 * RemoveMemberButton 组件测试
 * 覆盖：确认弹窗交互、移除成功刷新、失败 toast
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RemoveMemberButton } from "./remove-member-button";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const pushMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const removeMemberMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/team", () => ({
  removeMember: removeMemberMock,
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RemoveMemberButton", () => {
  it("点击后弹出确认对话框", async () => {
    const user = userEvent.setup();
    render(<RemoveMemberButton memberId="member-1" />);

    await user.click(screen.getByRole("button", { name: "team.list.removeMember" }));

    expect(await screen.findByText("team.list.removeConfirm")).toBeInTheDocument();
  });

  it("确认后调用 removeMember 并刷新路由", async () => {
    removeMemberMock.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<RemoveMemberButton memberId="member-1" />);

    await user.click(screen.getByRole("button"));
    const confirmBtn = await screen.findByRole("button", { name: "confirm" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(removeMemberMock).toHaveBeenCalledWith("member-1");
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });

  it("移除失败时展示 destructive toast 且不刷新", async () => {
    removeMemberMock.mockResolvedValue({ error: "databaseError" });
    const user = userEvent.setup();
    render(<RemoveMemberButton memberId="member-1" />);

    await user.click(screen.getByRole("button"));
    await user.click(await screen.findByRole("button", { name: "confirm" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
