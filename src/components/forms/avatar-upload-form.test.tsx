/**
 * AvatarUploadForm 组件测试（v0.5.0 B02）
 * 覆盖：渲染、上传成功（XHR hook + 刷新 + 重置）、失败 toast、进度与取消
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

const uploadMock = vi.hoisted(() => vi.fn());
const cancelMock = vi.hoisted(() => vi.fn());
let uploadState = { uploading: false, progress: 0 };
vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({
    uploading: uploadState.uploading,
    progress: uploadState.progress,
    upload: uploadMock,
    cancel: cancelMock,
  }),
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));

beforeEach(() => {
  vi.clearAllMocks();
  uploadState = { uploading: false, progress: 0 };
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
    uploadMock.mockResolvedValue({ ok: true, data: { url: "https://cdn.example/a.png" } });
    render(<AvatarUploadForm />);

    const input = document.getElementById("avatar") as HTMLInputElement;
    const file = new File([new Uint8Array(8)], "a.png", { type: "image/png" });
    await user.upload(input, file);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(uploadMock).toHaveBeenCalledWith(
        expect.objectContaining({ url: "/api/uploads/avatar", fieldName: "avatar", file }),
      );
      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "success" }));
    });
    expect(screen.getByRole("button", { name: "uploadAvatar" })).toBeDisabled();
  });

  it("上传失败：错误 toast，不刷新", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ ok: false, error: "fileTooLarge" });
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

  it("上传中显示进度并可取消", async () => {
    const user = userEvent.setup();
    uploadState = { uploading: true, progress: 42 };
    render(<AvatarUploadForm />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    await user.click(screen.getByRole("button", { name: "cancel" }));
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });

  it("用户取消后使用非破坏性取消提示", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ ok: false, error: "uploadCancelled" });
    render(<AvatarUploadForm />);

    const input = document.getElementById("avatar") as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array(8)], "a.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "uploadAvatar" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({ title: "cancelled", description: "uploadCancelled" });
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
