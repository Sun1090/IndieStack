/**
 * ProfileEditForm 组件测试
 * 覆盖：渲染、保存成功刷新、失败 toast
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileEditForm } from "./profile-edit-form";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const updateProfileSettingsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/profile", () => ({
  updateProfileSettings: updateProfileSettingsMock,
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProfileEditForm", () => {
  it("渲染全名/时区/简介字段", () => {
    render(<ProfileEditForm fullName="Alice" bio="hello" timezone="Asia/Shanghai" language="en" />);
    expect(document.getElementById("fullName")).toHaveValue("Alice");
    expect(document.getElementById("bio")).toHaveValue("hello");
  });

  it("保存成功后 refresh", async () => {
    updateProfileSettingsMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ProfileEditForm fullName="Alice" bio="" timezone="" language="en" />);

    const nameInput = document.getElementById("fullName")!;
    await user.clear(nameInput);
    await user.type(nameInput, "Bob");
    await user.click(screen.getByRole("button"));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("失败时展示 destructive toast", async () => {
    updateProfileSettingsMock.mockResolvedValue({ ok: false, error: "databaseError" });
    const user = userEvent.setup();
    render(<ProfileEditForm fullName="Alice" bio="" timezone="" language="en" />);

    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
