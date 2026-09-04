/**
 * contact-messages repository 单测（B05）
 * mock admin client，验证列表查询、计数与错误抛错
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { listRecentContactMessages, countContactMessages, setMessageStatus } from "./contact-messages";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listRecentContactMessages()", () => {
  it("成功返回倒序列表并透传 limit", async () => {
    const rows = [{ id: "m1", subject: "hi" }];
    const chain = chainMock({ data: rows });
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await expect(listRecentContactMessages(10)).resolves.toEqual(rows);
    expect(from).toHaveBeenCalledWith("contact_messages");
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(listRecentContactMessages()).rejects.toThrow("db");
  });
});

describe("setMessageStatus()", () => {
  function mockWithStatus(status: string | null) {
    const readChain = chainMock({ data: status ? { status } : null });
    const writeChain = chainMock({});
    const from = vi.fn((table: string) => {
      void table;
      return readChain;
    });
    // 第一次 from() 走读链，第二次走写链
    from.mockImplementationOnce(() => readChain);
    from.mockImplementationOnce(() => writeChain);
    createAdminClientMock.mockReturnValue({ from });
    return { readChain, writeChain, from };
  }

  it("向前流转成功", async () => {
    const { from } = mockWithStatus("new");
    await expect(setMessageStatus("m1", "in_progress")).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("new 可直达 resolved", async () => {
    mockWithStatus("new");
    await expect(setMessageStatus("m1", "resolved")).resolves.toBeUndefined();
  });

  it("回退抛 invalid_transition", async () => {
    mockWithStatus("resolved");
    await expect(setMessageStatus("m1", "new")).rejects.toThrow("invalid_transition");
  });

  it("同态流转抛 invalid_transition", async () => {
    mockWithStatus("in_progress");
    await expect(setMessageStatus("m1", "in_progress")).rejects.toThrow("invalid_transition");
  });

  it("读取失败抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(setMessageStatus("m1", "resolved")).rejects.toThrow("db");
  });
});

describe("countContactMessages()", () => {
  it("成功返回总数", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ count: 7 })));
    await expect(countContactMessages()).resolves.toBe(7);
  });

  it("count 为空回退 0", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({})));
    await expect(countContactMessages()).resolves.toBe(0);
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(countContactMessages()).rejects.toThrow("db");
  });
});
