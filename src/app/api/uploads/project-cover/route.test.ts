/** 项目封面上传 Route Handler：projectId 校验、服务调用与缓存失效。 */
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
vi.mock("@/lib/uploads/service", () => ({ uploadProjectCoverFile: uploadMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

import { POST } from "./route";

function guardWith(projectId: unknown) {
  const formData = new FormData();
  formData.set("cover", new File(["png"], "cover.png", { type: "image/png" }));
  if (projectId !== undefined) formData.set("projectId", String(projectId));
  return { ok: true, formData } as const;
}

function request() {
  return new NextRequest("https://indiestack.test/api/uploads/project-cover", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  guardMock.mockResolvedValue(guardWith("p1"));
  createClientMock.mockResolvedValue({ marker: "client" });
});

describe("POST /api/uploads/project-cover", () => {
  it("拒绝未通过请求边界的调用", async () => {
    guardMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ ok: false, error: "rateLimited" }, { status: 429 }),
    });
    expect((await POST(request())).status).toBe(429);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "x".repeat(129)])("拒绝非法 projectId", async (projectId) => {
    guardMock.mockResolvedValueOnce(guardWith(projectId));
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("成功上传后刷新项目详情页", async () => {
    uploadMock.mockResolvedValueOnce({ ok: true, data: { url: "https://cdn.example/c.png" } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(uploadMock).toHaveBeenCalledWith(
      { marker: "client" },
      "p1",
      expect.any(File),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(revalidateMock).toHaveBeenCalledWith("/dashboard/projects/p1");
  });

  it("权限错误映射为 403 且不刷新", async () => {
    uploadMock.mockResolvedValueOnce({ ok: false, error: "onlyAdminsCreateProject" });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
