/**
 * webauthn repository 单测（v0.5.0 D01，迁移 019）
 *
 * 五个函数各自的「error 必须变成抛错」都在这里钉：调用方（`auth-verify` / `register-options` 路由、
 * `deletePasskey` action、设置页）是靠抛不抛来分「读不到」和「读到且没有」的，
 * 少一条断言，路由就可能把一次数据库故障答成一次正常的 404。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createClientMock, createAdminClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import {
  listMyCredentials,
  findCredentialById,
  createCredential,
  updateCredentialCounter,
  deleteMyCredential,
} from "./webauthn";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listMyCredentials()", () => {
  it("返回当前用户凭据列表", async () => {
    const rows = [{ id: "w1", credential_id: "c1" }];
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({ data: rows })));
    await expect(listMyCredentials()).resolves.toEqual(rows);
  });

  it("数据库错误抛错", async () => {
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({ error: { message: "db" } })));
    await expect(listMyCredentials()).rejects.toThrow("db");
  });
});

describe("findCredentialById()", () => {
  it("按 credential_id 命中并含公钥", async () => {
    const row = { id: "w1", credential_id: "c1", public_key: "k", user_id: "u1" };
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ data: row })));
    await expect(findCredentialById("c1")).resolves.toEqual(row);
  });

  it("未命中返回 null", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({})));
    await expect(findCredentialById("cX")).resolves.toBeNull();
  });

  it("数据库错误抛错，不能与「没有这条凭据」同形", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "connection reset" } })),
    );
    await expect(findCredentialById("c1")).rejects.toThrow("connection reset");
  });
});

describe("createCredential()", () => {
  it("写入凭据字段", async () => {
    const chain = chainMock({});
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(
      createCredential({ userId: "u1", credentialId: "c1", publicKey: "k", counter: 0, deviceName: "Mac" }),
    ).resolves.toBeUndefined();
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", credential_id: "c1", public_key: "k", device_name: "Mac" }),
    );
  });

  it("写入失败抛错，不能让注册流程以为凭据已落库", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "duplicate key value" } })),
    );
    await expect(
      createCredential({ userId: "u1", credentialId: "c1", publicKey: "k", counter: 0 }),
    ).rejects.toThrow("duplicate key value");
  });
});

describe("updateCredentialCounter()", () => {
  it("更新计数器与最后使用时间", async () => {
    const chain = chainMock({});
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(updateCredentialCounter("c1", 5)).resolves.toBeUndefined();
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ counter: 5 }));
  });

  it("计数器写不进去抛错（克隆检测依赖它）", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "row-level security" } })),
    );
    await expect(updateCredentialCounter("c1", 6)).rejects.toThrow("row-level security");
  });
});

describe("deleteMyCredential()", () => {
  it("按 id 删除，并回答「真的删掉了行」", async () => {
    const chain = chainMock({ data: [{ id: "w1" }] });
    createClientMock.mockResolvedValue(dbClientMock(() => chain));
    await expect(deleteMyCredential("w1")).resolves.toBe(true);
    expect(chain.delete).toHaveBeenCalled();
    // 不 select 就拿不回受影响行，「删掉了」和「一行都没匹配上」会长成同一个样子
    expect(chain.select).toHaveBeenCalledWith("id");
  });

  it("0 行受影响返回 false：RLS 对不匹配的行是静默过滤，不是报错", async () => {
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({ data: null })));
    await expect(deleteMyCredential("not-mine")).resolves.toBe(false);
  });

  it("删除失败抛错，action 才会回 databaseError 而不是「已删除」", async () => {
    createClientMock.mockResolvedValue(
      dbClientMock(() => chainMock({ error: { message: "delete failed" } })),
    );
    await expect(deleteMyCredential("w1")).rejects.toThrow("delete failed");
  });
});
