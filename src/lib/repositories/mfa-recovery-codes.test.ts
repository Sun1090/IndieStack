/**
 * mfa-recovery-codes repository 单测（C01 测试职责）
 * mock admin client，验证查询/替换/消费与错误抛错
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import {
  listUnusedRecoveryCodes,
  hasUnusedRecoveryCodes,
  replaceRecoveryCodes,
  consumeRecoveryCode,
} from "./mfa-recovery-codes";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listUnusedRecoveryCodes()", () => {
  it("成功返回未使用列表", async () => {
    const rows = [{ id: "c1", code_hash: "ab", used_at: null }];
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ data: rows })));
    await expect(listUnusedRecoveryCodes("u1")).resolves.toEqual(rows);
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(listUnusedRecoveryCodes("u1")).rejects.toThrow("db");
  });
});

describe("hasUnusedRecoveryCodes()", () => {
  it("有码返回 true，无码返回 false", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ count: 3 })));
    await expect(hasUnusedRecoveryCodes("u1")).resolves.toBe(true);
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({})));
    await expect(hasUnusedRecoveryCodes("u1")).resolves.toBe(false);
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(hasUnusedRecoveryCodes("u1")).rejects.toThrow("db");
  });
});

describe("replaceRecoveryCodes()", () => {
  it("先清旧码再写入，返回行数", async () => {
    const insertChain = chainMock({ data: [{ id: "c1" }, { id: "c2" }] });
    const from = vi.fn((table: string) => {
      void table;
      return chainMock({});
    });
    // delete 链与 insert 链区分：用实现按调用次序返回
    from.mockImplementationOnce(() => chainMock({}));
    from.mockImplementationOnce(() => insertChain);
    createAdminClientMock.mockReturnValue({ from });
    await expect(replaceRecoveryCodes("u1", ["h1", "h2"])).resolves.toBe(2);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("空哈希仅清理返回 0", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({})));
    await expect(replaceRecoveryCodes("u1", [])).resolves.toBe(0);
  });

  it("删除失败抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(replaceRecoveryCodes("u1", ["h1"])).rejects.toThrow("db");
  });
});

describe("consumeRecoveryCode()", () => {
  it("抢占成功返回 true", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ data: [{ id: "c1" }] })),
    );
    await expect(consumeRecoveryCode("c1", "u1")).resolves.toBe(true);
  });

  it("已被消费返回 false", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ data: [] })));
    await expect(consumeRecoveryCode("c1", "u1")).resolves.toBe(false);
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(consumeRecoveryCode("c1", "u1")).rejects.toThrow("db");
  });
});
