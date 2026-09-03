/**
 * contact-messages repository 单测（B05）
 * mock admin client，验证列表查询、计数与错误抛错
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { listRecentContactMessages, countContactMessages } from "./contact-messages";

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
