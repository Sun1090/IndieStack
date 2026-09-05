/**
 * webauthn repository 单测（v0.5.0 D01，迁移 019）
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
});

describe("updateCredentialCounter()", () => {
  it("更新计数器与最后使用时间", async () => {
    const chain = chainMock({});
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(updateCredentialCounter("c1", 5)).resolves.toBeUndefined();
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ counter: 5 }));
  });
});

describe("deleteMyCredential()", () => {
  it("按 id 删除", async () => {
    const chain = chainMock({});
    createClientMock.mockResolvedValue(dbClientMock(() => chain));
    await expect(deleteMyCredential("w1")).resolves.toBeUndefined();
    expect(chain.delete).toHaveBeenCalled();
  });
});
