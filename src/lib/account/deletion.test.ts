/**
 * 账户删除编排单测（H08）
 *
 * 要锁住的是顺序与失败语义：擦除先于删号、擦除失败就不删号、
 * 删号后的审计补记失败不把成功说成失败、审计行不重新建立与已擦除身份的连接。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { eraseAccountDataMock, createAdminClientMock, appendAuditLogMock, logActionErrorMock } =
  vi.hoisted(() => ({
    eraseAccountDataMock: vi.fn(),
    createAdminClientMock: vi.fn(),
    appendAuditLogMock: vi.fn(),
    logActionErrorMock: vi.fn(),
  }));

vi.mock("@/lib/repositories/account-erasure", () => ({ eraseAccountData: eraseAccountDataMock }));
vi.mock("@/lib/repositories/audit-logs", () => ({ appendAuditLog: appendAuditLogMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/api-log", () => ({ logActionError: logActionErrorMock }));

import { deleteAccountWithData } from "./deletion";

const CALLS: string[] = [];
const ERASURE = { apiUsage: 3, contactMessages: 1, auditLogsAnonymized: 9 };

function adminClient(deleteError: { message: string } | null = null) {
  createAdminClientMock.mockReturnValue({
    auth: {
      admin: {
        deleteUser: vi.fn(async () => {
          CALLS.push("deleteUser");
          return { error: deleteError };
        }),
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  CALLS.length = 0;
  eraseAccountDataMock.mockImplementation(async () => {
    CALLS.push("erase");
    return ERASURE;
  });
  appendAuditLogMock.mockResolvedValue(undefined);
  adminClient();
});

describe("deleteAccountWithData", () => {
  it("先擦除个人数据，再删除账户", async () => {
    const result = await deleteAccountWithData("u1");

    expect(CALLS).toEqual(["erase", "deleteUser"]);
    expect(result.erasure).toEqual(ERASURE);
  });

  it("擦除失败时不删号（可重试，且不会留下无法补救的状态）", async () => {
    eraseAccountDataMock.mockRejectedValue(new Error("erase unavailable"));

    await expect(deleteAccountWithData("u1")).rejects.toThrow("erase unavailable");
    expect(CALLS).not.toContain("deleteUser");
  });

  it("删号报错时上抛，让调用方返回失败而不是假装已删除", async () => {
    adminClient({ message: "GoTrue unavailable" });

    await expect(deleteAccountWithData("u1")).rejects.toThrow("GoTrue unavailable");
    expect(appendAuditLogMock).not.toHaveBeenCalled();
  });

  it("审计补记只留事件、不重建身份连接", async () => {
    await deleteAccountWithData("u1");

    expect(appendAuditLogMock).toHaveBeenCalledWith({
      userId: null,
      action: "account.deleted",
      entityType: "user",
      entityId: null,
      metadata: { apiUsage: 3, contactMessages: 1, auditLogsAnonymized: 9 },
    });
  });

  it("账户已删除后审计补记失败只记日志，不把成功报成失败", async () => {
    appendAuditLogMock.mockRejectedValue(new Error("audit insert rejected"));

    await expect(deleteAccountWithData("u1")).resolves.toEqual({ erasure: ERASURE });
    expect(logActionErrorMock).toHaveBeenCalled();
  });
});
