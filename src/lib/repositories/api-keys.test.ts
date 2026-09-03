/**
 * api-keys repository 单测（B03）
 * mock server client，验证列表/插入/吊销与错误抛错
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

import { listApiKeysByUser, insertApiKey, deactivateApiKey } from "./api-keys";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listApiKeysByUser()", () => {
  it("成功返回密钥列表", async () => {
    const rows = [{ id: "k1", user_id: "u1" }];
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({ data: rows })));
    await expect(listApiKeysByUser("u1")).resolves.toEqual(rows);
  });

  it("数据库错误抛错", async () => {
    createClientMock.mockResolvedValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(listApiKeysByUser("u1")).rejects.toThrow("db");
  });
});

describe("insertApiKey()", () => {
  it("成功返回插入的行", async () => {
    const row = { id: "k1", key: "sk-xxx" };
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({ data: row })));
    await expect(insertApiKey({ key: "sk-xxx" })).resolves.toEqual(row);
  });

  it("数据库错误抛错", async () => {
    createClientMock.mockResolvedValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(insertApiKey({})).rejects.toThrow("db");
  });
});

describe("deactivateApiKey()", () => {
  it("成功吊销不抛错", async () => {
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({})));
    await expect(deactivateApiKey("u1", "k1")).resolves.toBeUndefined();
  });

  it("数据库错误抛错", async () => {
    createClientMock.mockResolvedValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(deactivateApiKey("u1", "k1")).rejects.toThrow("db");
  });
});
