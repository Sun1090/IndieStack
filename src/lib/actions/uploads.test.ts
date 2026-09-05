/**
 * uploadAvatar action 单测（v0.5.0 B01/B02）
 * 覆盖：鉴权、文件校验（必填/类型/大小）、存储写入、profiles 回写、错误兜底
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClientMock, revalidatePathMock, putMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  putMock: vi.fn(async () => "https://cdn.example/avatars/u1/k.png"),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/storage", () => ({
  getStorageDriver: () => ({ put: putMock }),
  buildObjectKey: vi.fn(() => "avatars/u1/1-abc.png"),
  ALLOWED_IMAGE_TYPES: { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" },
  AVATAR_MAX_BYTES: 2 * 1024 * 1024,
}));

import { uploadAvatar, uploadProjectCover } from "./uploads";

const USER = { id: "u1", email: "a@b.c" };

function mockClient(opts: { user?: object | null; profileUpdateError?: boolean } = {}) {
  const { user = USER, profileUpdateError = false } = opts;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() =>
          Promise.resolve(profileUpdateError ? { error: { message: "db" } } : { error: null }),
        ),
      })),
    })),
  };
}

function file(input: { name?: string; type?: string; size?: number } = {}) {
  const { name = "avatar.png", type = "image/png", size = 1024 } = input;
  return new File([new Uint8Array(size)], name, { type });
}

function form(f: File | null) {
  const fd = new FormData();
  if (f) fd.set("avatar", f);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("uploadAvatar()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(uploadAvatar(form(file()))).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("缺文件返回 fileRequired", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(uploadAvatar(form(null))).resolves.toEqual({ ok: false, error: "fileRequired" });
  });

  it("类型不在白名单返回 fileTypeUnsupported", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(uploadAvatar(form(file({ type: "application/pdf" })))).resolves.toEqual({
      ok: false,
      error: "fileTypeUnsupported",
    });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("超过 2MB 返回 fileTooLarge", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(
      uploadAvatar(form(file({ type: "image/png", size: 2 * 1024 * 1024 + 1 }))),
    ).resolves.toEqual({ ok: false, error: "fileTooLarge" });
  });

  it("成功：写入存储、回写 avatar_url 并 revalidate", async () => {
    const client = mockClient();
    createClientMock.mockResolvedValue(client);
    const result = await uploadAvatar(form(file()));

    expect(result).toEqual({ ok: true, data: { url: "https://cdn.example/avatars/u1/k.png" } });
    expect(putMock).toHaveBeenCalledWith("avatars/u1/1-abc.png", expect.any(Buffer), "image/png");
    expect(client.from).toHaveBeenCalledWith("profiles");
    expect(revalidatePathMock).toHaveBeenCalledTimes(2);
  });

  it("存储抛错返回 uploadFailed", async () => {
    createClientMock.mockResolvedValue(mockClient());
    putMock.mockRejectedValueOnce(new Error("storage down"));
    await expect(uploadAvatar(form(file()))).resolves.toEqual({ ok: false, error: "uploadFailed" });
  });

  it("profiles 回写失败返回 uploadFailed", async () => {
    createClientMock.mockResolvedValue(mockClient({ profileUpdateError: true }));
    await expect(uploadAvatar(form(file()))).resolves.toEqual({ ok: false, error: "uploadFailed" });
  });
});

function coverForm(f: File | null) {
  const fd = new FormData();
  if (f) fd.set("cover", f);
  return fd;
}

describe("uploadProjectCover()", () => {
  function coverClient(opts: {
    user?: object | null;
    projectRow?: object | null;
    membership?: object | null;
    projectUpdateError?: boolean;
  } = {}) {
    const {
      user = USER,
      projectRow = { team_id: "t1" },
      membership = { role: "admin" },
      projectUpdateError = false,
    } = opts;
    return {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
      from: vi.fn((table: string) => {
        if (table === "projects") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({ data: projectRow })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() =>
                Promise.resolve(projectUpdateError ? { error: { message: "db" } } : { error: null }),
              ),
            })),
          };
        }
        if (table === "team_members") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(() => Promise.resolve({ data: membership })),
                })),
              })),
            })),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    };
  }

  it("项目不存在返回 projectNotFound", async () => {
    createClientMock.mockResolvedValue(coverClient({ projectRow: null }));
    await expect(uploadProjectCover("p1", coverForm(file()))).resolves.toEqual({
      ok: false,
      error: "projectNotFound",
    });
  });

  it("非 owner/admin 返回 onlyAdminsCreateProject", async () => {
    createClientMock.mockResolvedValue(coverClient({ membership: { role: "member" } }));
    await expect(uploadProjectCover("p1", coverForm(file()))).resolves.toEqual({
      ok: false,
      error: "onlyAdminsCreateProject",
    });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("缺文件返回 fileRequired", async () => {
    createClientMock.mockResolvedValue(coverClient());
    await expect(uploadProjectCover("p1", form(null))).resolves.toEqual({
      ok: false,
      error: "fileRequired",
    });
  });

  it("成功：写入存储、回写 logo_url 并 revalidate 项目页", async () => {
    const client = coverClient();
    createClientMock.mockResolvedValue(client);
    const result = await uploadProjectCover("p1", coverForm(file({ name: "cover.webp", type: "image/webp" })));

    expect(result).toEqual({ ok: true, data: { url: "https://cdn.example/avatars/u1/k.png" } });
    expect(putMock).toHaveBeenCalledWith("avatars/u1/1-abc.png", expect.any(Buffer), "image/webp");
    expect(client.from).toHaveBeenCalledWith("projects");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/projects/p1");
  });

  it("存储抛错返回 uploadFailed", async () => {
    createClientMock.mockResolvedValue(coverClient());
    putMock.mockRejectedValueOnce(new Error("storage down"));
    await expect(uploadProjectCover("p1", coverForm(file()))).resolves.toEqual({
      ok: false,
      error: "uploadFailed",
    });
  });
});
