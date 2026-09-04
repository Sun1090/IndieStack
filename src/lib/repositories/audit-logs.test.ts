/**
 * audit-logs repository 单测（B04）
 * mock admin client，验证分页查询、兼容函数与错误抛错
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { listAuditLogsPage, listAllAuditLogs, appendAuditLog } from "./audit-logs";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAuditLogsPage()", () => {
  it("成功返回行与总数", async () => {
    const rows = [{ id: 1, action: "login" }];
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ data: rows, count: 5 })));
    await expect(listAuditLogsPage(2, 10)).resolves.toEqual({ rows, total: 5 });
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(listAuditLogsPage()).rejects.toThrow("db");
  });
});

describe("appendAuditLog()", () => {
  const event = {
    userId: "u1",
    action: "auth.login",
    entityType: "auth",
    entityId: "u1",
    metadata: { method: "password" },
  };

  it("成功写入并透传字段", async () => {
    const chain = chainMock({});
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await expect(appendAuditLog(event)).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith("audit_logs");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", action: "auth.login", entity_type: "auth" }),
    );
  });

  it("缺省字段回退空值", async () => {
    const chain = chainMock({});
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await appendAuditLog({ userId: null, action: "auth.login_failed", entityType: "auth" });
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: null, entity_id: null }),
    );
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(appendAuditLog(event)).rejects.toThrow("db");
  });
});

describe("listAllAuditLogs()", () => {
  it("委托首页 100 条查询", async () => {
    const chain = chainMock({ data: [{ id: 1 }], count: 1 });
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await expect(listAllAuditLogs()).resolves.toEqual([{ id: 1 }]);
    expect(from).toHaveBeenCalledWith("audit_logs");
    expect(chain.range).toHaveBeenCalledWith(0, 99);
  });
});
