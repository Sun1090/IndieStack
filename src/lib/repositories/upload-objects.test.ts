/** 上传元数据仓库单测（H02）：写入形状、复合冲突键与错误传播。 */
import { describe, expect, it, vi } from "vitest";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { markUploadObjectDeleted, recordUploadObject } from "./upload-objects";

const CHECKSUM = "a".repeat(64);

function admin(error: { message: string } | null = null) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const updateEq2 = vi.fn().mockResolvedValue({ error });
  const updateEq1 = vi.fn(() => ({ eq: updateEq2 }));
  const update = vi.fn(() => ({ eq: updateEq1 }));
  const from = vi.fn(() => ({ upsert, update }));
  createAdminClientMock.mockReturnValue({ from });
  return { from, upsert, update, updateEq1, updateEq2 };
}

describe("upload objects repository", () => {
  it("按 (bucket, object_key) 复合键 upsert，并把状态复位为 active", async () => {
    const a = admin();
    await recordUploadObject({
      bucket: "avatars",
      objectKey: "avatars/u1/a.png",
      ownerId: "u1",
      byteSize: 128,
      contentType: "image/png",
      checksum: CHECKSUM,
    });

    expect(a.from).toHaveBeenCalledWith("upload_objects");
    expect(a.upsert).toHaveBeenCalledWith(
      {
        bucket: "avatars",
        object_key: "avatars/u1/a.png",
        owner_id: "u1",
        byte_size: 128,
        content_type: "image/png",
        checksum: CHECKSUM,
        status: "active",
      },
      { onConflict: "bucket,object_key" },
    );
  });

  it("写入失败时把驱动错误抛给调用方（由 service 决定回滚对象）", async () => {
    admin({ message: "db down" });
    await expect(
      recordUploadObject({
        bucket: "avatars",
        objectKey: "k",
        ownerId: "u1",
        byteSize: 1,
        contentType: "image/png",
        checksum: CHECKSUM,
      }),
    ).rejects.toThrow("db down");
  });

  it("标记删除时同时按 bucket 与 object_key 过滤，不会跨桶误伤", async () => {
    const a = admin();
    await markUploadObjectDeleted("avatars", "avatars/u1/a.png");

    expect(a.update).toHaveBeenCalledWith({ status: "deleted" });
    expect(a.updateEq1).toHaveBeenCalledWith("bucket", "avatars");
    expect(a.updateEq2).toHaveBeenCalledWith("object_key", "avatars/u1/a.png");
  });

  it("标记删除失败同样抛出，避免把未清理的对象当成已清理", async () => {
    admin({ message: "db down" });
    await expect(markUploadObjectDeleted("avatars", "k")).rejects.toThrow("db down");
  });
});
