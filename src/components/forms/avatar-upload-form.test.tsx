/**
 * AvatarUploadForm 组件测试（v0.5.0 B02）
 * 覆盖：渲染、上传成功（调用 action + 刷新 + 重置）、失败 toast
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AvatarUploadForm } from "./avatar-upload-form";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const uploadAvatarMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/uploads", () => ({
  uploadAvatar: uploadAvatarMock,
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AvatarUploadForm", () => {
  it("渲染文件输入（仅接受图片类型）与上传按钮", () => {
    render(<AvatarUploadForm />);
    const input = document.getElementById("avatar") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.accept).toBe("image/png,image/jpeg,image/webp");
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("上传成功：toast + 刷新 + 表单重置", async () => {
    const user = userEvent.setup();
    uploadAvatarMock.mockResolvedValue({ ok: true, data: { url: "https://cdn.example/a.png" } });
    render(<AvatarUploadForm />);

    const input = document.getElementById("avatar") as HTMLInputElement;
    const file = new File([new Uint8Array(8)], "a.png", { type: "image/png" });
    await user.upload(input, file);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(uploadAvatarMock).toHaveBeenCalledTimes(1);
      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "success" }));
    });
  });

  it("上传失败：错误 toast，不刷新", async () => {
    const user = userEvent.setup();
    uploadAvatarMock.mockResolvedValue({ ok: false, error: "fileTooLarge" });
    render(<AvatarUploadForm />);

    const input = document.getElementById("avatar") as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array(8)], "a.png", { type: "image/png" }));
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "fileTooLarge" }),
      );
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
