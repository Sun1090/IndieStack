/** 上传领域服务单测：共享安全校验、取消与回滚边界。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadObjectRecord } from "@/lib/repositories/upload-objects";

const { putMock, removeMock, cleanupUrlMock, extractKeyMock, recordMock, markDeletedMock } =
  vi.hoisted(() => ({
    putMock: vi.fn(async () => "https://cdn.example/uploads/k.png"),
    removeMock: vi.fn(async () => true),
    cleanupUrlMock: vi.fn(async () => true),
    extractKeyMock: vi.fn(
      (_url: string | null | undefined, _prefix: string, _tenantId: string): string | null => null,
    ),
    recordMock: vi.fn(async (_record: UploadObjectRecord) => undefined),
    markDeletedMock: vi.fn(async () => undefined),
  }));

vi.mock("@/lib/storage", () => ({
  ALLOWED_IMAGE_TYPES: { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" },
  AVATAR_MAX_BYTES: 2 * 1024 * 1024,
  buildObjectKey: () => "avatars/u1/key.png",
  cleanupManagedStorageUrl: cleanupUrlMock,
  cleanupStorageObject: removeMock,
  extractManagedObjectKey: extractKeyMock,
  getStorageDriver: () => ({ put: putMock }),
}));

// H02：服务层在 put 之后必须落 upload_objects 元数据，这里拦截数据访问层
vi.mock("@/lib/repositories/upload-objects", () => ({
  recordUploadObject: recordMock,
  markUploadObjectDeleted: markDeletedMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  hasSupportedImageSignature,
  isAllowedImageType,
  uploadAvatarFile,
  uploadProjectCoverFile,
  validateImageFile,
} from "./service";

const USER = { id: "u1", email: "a@b.c" };

function png(size = 64): File {
  const bytes = new Uint8Array(Math.max(size, 12));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([bytes], "avatar.png", { type: "image/png" });
}

function supabaseForAvatar(updateError = false) {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: USER } })) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { avatar_url: null } })) })),
      })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: updateError ? {} : null })) })),
    })),
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe("上传校验", () => {
  it("白名单只接受三个自有图片 MIME", () => {
    expect(isAllowedImageType("image/png")).toBe(true);
    expect(isAllowedImageType("image/jpeg")).toBe(true);
    expect(isAllowedImageType("image/webp")).toBe(true);
    expect(isAllowedImageType("toString")).toBe(false);
    expect(isAllowedImageType("application/pdf")).toBe(false);
  });

  it("拒绝空文件、非 File、未知类型与超限文件", () => {
    expect(validateImageFile(null)).toBe("fileRequired");
    expect(validateImageFile(new File([], "empty.png", { type: "image/png" }))).toBe("fileRequired");
    expect(validateImageFile("not-a-file")).toBe("fileRequired");
    expect(validateImageFile(png())).toBeNull();
    expect(validateImageFile(new File([new Uint8Array(8)], "x.pdf", { type: "application/pdf" }))).toBe(
      "fileTypeUnsupported",
    );
    expect(validateImageFile(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "x.png", { type: "image/png" }))).toBe(
      "fileTooLarge",
    );
  });

  it("按文件头识别 PNG、JPEG、WebP 并拒绝伪造 MIME", () => {
    expect(hasSupportedImageSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png")).toBe(true);
    expect(hasSupportedImageSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).toBe(true);
    expect(hasSupportedImageSignature(Buffer.from("RIFF0000WEBP"), "image/webp")).toBe(true);
    expect(hasSupportedImageSignature(Buffer.from("not-an-image"), "image/png")).toBe(false);
    expect(hasSupportedImageSignature(Buffer.alloc(0), "image/jpeg")).toBe(false);
  });
});

describe("uploadAvatarFile", () => {
  it("未登录不读取文件", async () => {
    const supabase = { auth: { getUser: vi.fn(async () => ({ data: { user: null } })) } } as never;
    await expect(uploadAvatarFile(supabase, png())).resolves.toEqual({ ok: false, error: "notAuthenticated" });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("请求已取消时不写入存储", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadAvatarFile(supabaseForAvatar(), png(), { signal: controller.signal })).resolves.toEqual({
      ok: false,
      error: "uploadCancelled",
    });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("伪造图片 MIME 被文件头拦截", async () => {
    const fake = new File([new Uint8Array(64)], "fake.png", { type: "image/png" });
    await expect(uploadAvatarFile(supabaseForAvatar(), fake)).resolves.toEqual({
      ok: false,
      error: "fileTypeUnsupported",
    });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("存储过程中取消会清理已写入对象", async () => {
    const controller = new AbortController();
    putMock.mockImplementationOnce(async () => {
      controller.abort();
      return "https://cdn.example/uploads/k.png";
    });
    await expect(uploadAvatarFile(supabaseForAvatar(), png(), { signal: controller.signal })).resolves.toEqual({
      ok: false,
      error: "uploadCancelled",
    });
    expect(removeMock).toHaveBeenCalledWith("avatars/u1/key.png", expect.any(Object));
  });

  it("元数据写入失败会回滚对象", async () => {
    await expect(uploadAvatarFile(supabaseForAvatar(true), png())).resolves.toEqual({
      ok: false,
      error: "uploadFailed",
    });
    expect(removeMock).toHaveBeenCalledWith("avatars/u1/key.png", expect.any(Object));
  });

  it("存储异常返回稳定错误", async () => {
    putMock.mockRejectedValueOnce(new Error("storage down"));
    await expect(uploadAvatarFile(supabaseForAvatar(), png())).resolves.toEqual({
      ok: false,
      error: "uploadFailed",
    });
  });

  it("成功上传先落元数据再回写 profiles，并记录 bucket/所有者/大小/哈希", async () => {
    const profileUpdate = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
    const supabase = {
      auth: { getUser: vi.fn(async () => ({ data: { user: USER } })) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { avatar_url: null } })) })),
        })),
        update: profileUpdate,
      })),
    } as never;

    await expect(uploadAvatarFile(supabase, png())).resolves.toEqual({
      ok: true,
      data: { url: "https://cdn.example/uploads/k.png" },
    });

    expect(recordMock).toHaveBeenCalledTimes(1);
    const record = recordMock.mock.calls[0][0];
    expect(record).toMatchObject({
      bucket: "avatars",
      objectKey: "avatars/u1/key.png",
      ownerId: "u1",
      contentType: "image/png",
      byteSize: expect.any(Number),
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(record.byteSize).toBeGreaterThan(0);
    // 顺序必须是 put → 元数据 → 业务表：反了会在回写成功后留下没有元数据的 URL
    expect(putMock.mock.invocationCallOrder[0]).toBeLessThan(
      recordMock.mock.invocationCallOrder[0],
    );
    expect(recordMock.mock.invocationCallOrder[0]).toBeLessThan(
      profileUpdate.mock.invocationCallOrder[0],
    );
    expect(markDeletedMock).not.toHaveBeenCalled();
  });

  it("元数据写入失败时删除已上传对象并返回 uploadFailed", async () => {
    recordMock.mockRejectedValueOnce(new Error("db down"));
    await expect(uploadAvatarFile(supabaseForAvatar(), png())).resolves.toEqual({
      ok: false,
      error: "uploadFailed",
    });
    expect(removeMock).toHaveBeenCalledWith("avatars/u1/key.png", expect.any(Object));
    // 对象已删除 → 元数据标记为 deleted（此时行通常不存在，是 no-op）
    expect(markDeletedMock).toHaveBeenCalledWith("avatars", "avatars/u1/key.png");
  });

  it("替换头像成功后把旧对象标记为 deleted", async () => {
    extractKeyMock.mockReturnValueOnce("avatars/u1/old.png");
    await expect(uploadAvatarFile(supabaseForAvatar(), png())).resolves.toEqual({
      ok: true,
      data: { url: "https://cdn.example/uploads/k.png" },
    });
    expect(cleanupUrlMock).toHaveBeenCalled();
    expect(markDeletedMock).toHaveBeenCalledWith("avatars", "avatars/u1/old.png");
  });

  it("旧对象删除失败时不标记 deleted（对象可能仍在 bucket 里）", async () => {
    extractKeyMock.mockReturnValueOnce("avatars/u1/old.png");
    cleanupUrlMock.mockResolvedValueOnce(false);
    await uploadAvatarFile(supabaseForAvatar(), png());
    expect(markDeletedMock).not.toHaveBeenCalledWith("avatars", "avatars/u1/old.png");
  });
});

describe("uploadProjectCoverFile", () => {
  function coverClient(project: { team_id: string; logo_url: string | null } | null, role: string | null) {
    return {
      auth: { getUser: vi.fn(async () => ({ data: { user: USER } })) },
      from: vi.fn((table: string) => {
        if (table === "projects") {
          return {
            select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: project })) })) })),
            update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: role ? { role } : null })) })),
            })),
          })),
        };
      }),
    } as never;
  }

  it("项目不存在返回 projectNotFound", async () => {
    await expect(uploadProjectCoverFile(coverClient(null, "admin"), "p1", png())).resolves.toEqual({
      ok: false,
      error: "projectNotFound",
    });
  });

  it("普通成员不能上传封面", async () => {
    await expect(uploadProjectCoverFile(coverClient({ team_id: "t1", logo_url: null }, "member"), "p1", png())).resolves.toEqual({
      ok: false,
      error: "onlyAdminsCreateProject",
    });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("owner/admin 可成功上传", async () => {
    await expect(uploadProjectCoverFile(coverClient({ team_id: "t1", logo_url: null }, "admin"), "p1", png())).resolves.toEqual({
      ok: true,
      data: { url: "https://cdn.example/uploads/k.png" },
    });
  });

  it("封面成功上传同样落元数据，owner 是上传者而不是 projectId", async () => {
    await uploadProjectCoverFile(coverClient({ team_id: "t1", logo_url: null }, "admin"), "p1", png());
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "avatars",
        objectKey: "avatars/u1/key.png",
        ownerId: "u1",
        contentType: "image/png",
      }),
    );
  });
});
