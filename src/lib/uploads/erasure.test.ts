/**
 * 账户删除时的受管对象清理单测（A10）
 *
 * 锁住三件事：被引用的对象绝不删（团队封面不该因为上传者销号而 404）、
 * provider 删除失败不阻塞删号但必须留在失败清单里（那是可补删的孤儿），
 * 以及枚举失败会抛出（宁可让删号可重试，也不要「以为没有对象」）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listObjectsForErasureMock, markUploadObjectDeletedMock, cleanupStorageObjectMock, loggerErrorMock } =
  vi.hoisted(() => ({
    listObjectsForErasureMock: vi.fn(),
    markUploadObjectDeletedMock: vi.fn(),
    cleanupStorageObjectMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  }));

vi.mock("@/lib/repositories/upload-objects", () => ({
  listObjectsForErasure: listObjectsForErasureMock,
  markUploadObjectDeleted: markUploadObjectDeletedMock,
}));
vi.mock("@/lib/storage", () => ({ cleanupStorageObject: cleanupStorageObjectMock }));
vi.mock("@/lib/logger", () => ({ logger: { error: loggerErrorMock, info: vi.fn(), warn: vi.fn() } }));

import { removeUnreferencedUserObjects } from "./erasure";

beforeEach(() => {
  vi.clearAllMocks();
  markUploadObjectDeletedMock.mockResolvedValue(undefined);
  cleanupStorageObjectMock.mockResolvedValue(true);
});

describe("removeUnreferencedUserObjects", () => {
  it("只删除未被引用的对象，并逐个标记元数据为 deleted", async () => {
    listObjectsForErasureMock.mockResolvedValue([
      { bucket: "avatars", objectKey: "avatars/u1/avatar.png", referenced: false },
      { bucket: "avatars", objectKey: "avatars/u1/team-cover.png", referenced: true },
    ]);

    await expect(removeUnreferencedUserObjects("u1")).resolves.toEqual({
      removed: 1,
      retained: 1,
      failed: [],
    });
    expect(cleanupStorageObjectMock).toHaveBeenCalledTimes(1);
    expect(cleanupStorageObjectMock).toHaveBeenCalledWith("avatars/u1/avatar.png", {
      operation: "account-erasure",
      resourceId: "u1",
    });
    expect(markUploadObjectDeletedMock).toHaveBeenCalledWith("avatars", "avatars/u1/avatar.png");
  });

  it("provider 删除失败时不标记元数据，对象留在孤儿清单里", async () => {
    listObjectsForErasureMock.mockResolvedValue([
      { bucket: "avatars", objectKey: "avatars/u1/a.png", referenced: false },
    ]);
    cleanupStorageObjectMock.mockResolvedValue(false);

    await expect(removeUnreferencedUserObjects("u1")).resolves.toEqual({
      removed: 0,
      retained: 0,
      failed: ["avatars/u1/a.png"],
    });
    expect(markUploadObjectDeletedMock).not.toHaveBeenCalled();
  });

  it("对象已删但元数据标记失败时计入失败并记录，不会误报为已清理", async () => {
    listObjectsForErasureMock.mockResolvedValue([
      { bucket: "avatars", objectKey: "avatars/u1/a.png", referenced: false },
    ]);
    markUploadObjectDeletedMock.mockRejectedValue(new Error("db down"));

    await expect(removeUnreferencedUserObjects("u1")).resolves.toEqual({
      removed: 0,
      retained: 0,
      failed: ["avatars/u1/a.png"],
    });
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  it("枚举失败直接抛出，删号流程因此中止", async () => {
    listObjectsForErasureMock.mockRejectedValue(new Error("permission denied"));
    await expect(removeUnreferencedUserObjects("u1")).rejects.toThrow("permission denied");
    expect(cleanupStorageObjectMock).not.toHaveBeenCalled();
  });
});
