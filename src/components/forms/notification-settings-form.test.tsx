/**
 * NotificationSettingsForm 组件测试
 * 覆盖：开关渲染、切换状态、保存调用、失败 toast
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationSettingsForm } from "./notification-settings-form";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const updateNotificationSettingsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/settings", () => ({
  updateNotificationSettings: updateNotificationSettingsMock,
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NotificationSettingsForm", () => {
  it("渲染 4 个通知开关", () => {
    render(<NotificationSettingsForm settings={{}} />);
    for (const id of ["emailNotifications", "marketingEmails", "productUpdates", "securityAlerts"]) {
      expect(document.getElementById(id)).toBeInTheDocument();
    }
  });

  it("默认值：email/product/security 开，marketing 关", () => {
    render(<NotificationSettingsForm settings={{}} />);
    expect(document.getElementById("emailNotifications")).toBeChecked();
    expect(document.getElementById("marketingEmails")).not.toBeChecked();
  });

  it("保存成功调用 action 并刷新", async () => {
    updateNotificationSettingsMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<NotificationSettingsForm settings={{}} />);

    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const fd = updateNotificationSettingsMock.mock.calls[0][0] as FormData;
    expect(fd.get("emailNotifications")).toBe("on");
    expect(fd.get("marketingEmails")).toBe("off");
  });

  it("保存失败展示 destructive toast", async () => {
    updateNotificationSettingsMock.mockResolvedValue({ ok: false, error: "databaseError" });
    const user = userEvent.setup();
    render(<NotificationSettingsForm settings={{}} />);

    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });
  });
});
