/** 头像上传 Route Handler：请求边界、服务调用、缓存失效与状态码。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { guardMock, createClientMock, uploadMock, revalidateMock } = vi.hoisted(() => ({
  guardMock: vi.fn(),
  createClientMock: vi.fn(),
  uploadMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock("@/lib/uploads/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/uploads/request")>()),
  guardUploadRequest: guardMock,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/uploads/service", () => ({ uploadAvatarFile: uploadMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

import { POST } from "./route";

function validGuard() {
  const formData = new FormData();
  formData.set("avatar", new File(["png"], "a.png", { type: "image/png" }));
  return { ok: true, formData } as const;
}

function request() {
  return new NextRequest("https://indiestack.test/api/uploads/avatar", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  guardMock.mockResolvedValue(validGuard());
  createClientMock.mockResolvedValue({ marker: "client" });
});

describe("POST /api/uploads/avatar", () => {
  it("拒绝未通过请求边界的调用", async () => {
    guardMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }),
    });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("成功上传后刷新个人资料页面", async () => {
    uploadMock.mockResolvedValueOnce({ ok: true, data: { url: "https://cdn.example/a.png" } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: { url: "https://cdn.example/a.png" } });
    expect(uploadMock).toHaveBeenCalledWith(
      { marker: "client" },
      expect.any(File),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(revalidateMock).toHaveBeenCalledWith("/dashboard/profile");
    expect(revalidateMock).toHaveBeenCalledWith("/dashboard/profile/edit");
  });

  it("服务错误映射为对应 HTTP 状态且不刷新", async () => {
    uploadMock.mockResolvedValueOnce({ ok: false, error: "fileTooLarge" });
    const response = await POST(request());
    expect(response.status).toBe(413);
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
