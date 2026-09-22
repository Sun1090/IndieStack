/**
 * MarkAllReadButton 组件测试
 * 覆盖：未读为 0 时不渲染、成功 toast、失败必须说话（destructive toast）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarkAllReadButton } from "./mark-all-read-button";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const markAllReadMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/notifications", () => ({
  markAllNotificationsRead: markAllReadMock,
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MarkAllReadButton", () => {
  it("没有未读时不渲染按钮", () => {
    const { container } = render(<MarkAllReadButton unreadCount={0} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("成功时提示已读，不出现失败 toast", async () => {
    markAllReadMock.mockResolvedValue({ ok: true, data: { updated: 3 } });
    const user = userEvent.setup();
    render(<MarkAllReadButton unreadCount={3} />);

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(markAllReadMock).toHaveBeenCalled();
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "notifications.list.markAllRead" }),
      );
    });
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });

  it("失败时展示 destructive toast，而不是安静地什么都不说", async () => {
    markAllReadMock.mockResolvedValue({ ok: false, error: "databaseError" });
    const user = userEvent.setup();
    render(<MarkAllReadButton unreadCount={3} />);

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "databaseError" }),
      );
    });
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "notifications.list.markAllRead" }),
    );
  });
});
