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
  /**
   * `update` 的返回链必须自己带 `.select()`，否则 `data` 永远是 `null`、0 行与成功同形。
   * 共享的 chainMock 所有 builder 都返回同一个链，所以「有没有 select」只能显式钉。
   */
  function captureChain(outcome: Parameters<typeof chainMock>[0]) {
    const chain = chainMock(outcome);
    createClientMock.mockResolvedValue(dbClientMock(() => chain));
    return chain;
  }

  it("改掉一行时返回 true，并且真的把 `update` 的结果 select 回来", async () => {
    const chain = captureChain({ data: [{ id: "k1" }] });
    await expect(deactivateApiKey("u1", "k1")).resolves.toBe(true);
    expect(chain.update).toHaveBeenCalled();
    expect(chain.select).toHaveBeenCalled();
  });

  it("0 行受影响时返回 false，而不是把它当成成功", async () => {
    captureChain({ data: [] });
    await expect(deactivateApiKey("u1", "k1")).resolves.toBe(false);
  });

  it("数据库错误抛错", async () => {
    createClientMock.mockResolvedValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(deactivateApiKey("u1", "k1")).rejects.toThrow("db");
  });
});
