/**
 * 联系消息查询服务端操作单元测试
 * mock guards 的 safelyRequireRole 与 contact-messages 仓库，验证 RBAC 守卫与字段映射
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { safelyRequireRoleMock, listRecentContactMessagesMock, setMessageStatusMock, revalidatePathMock, listPageMock } =
  vi.hoisted(() => ({
    safelyRequireRoleMock: vi.fn(),
    listRecentContactMessagesMock: vi.fn(),
    setMessageStatusMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    listPageMock: vi.fn(),
  }));

vi.mock("@/lib/auth/guards", () => ({ safelyRequireRole: safelyRequireRoleMock }));
vi.mock("@/lib/repositories/contact-messages", () => ({
  listRecentContactMessages: listRecentContactMessagesMock,
  setMessageStatus: setMessageStatusMock,
  listContactMessagesPage: listPageMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { listContactMessages, updateMessageStatus, listContactMessagesPage } from "./contact-messages";

function unauthorized() {
  return { success: false, error: { code: "UNAUTHORIZED" } };
}
function forbidden() {
  return { success: false, error: { code: "FORBIDDEN" } };
}
function authed() {
  return { success: true, data: { id: "u1", email: "a@b.com", role: "super_admin" } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listContactMessages()", () => {
  it("未登录返回 notAuthenticated", async () => {
    safelyRequireRoleMock.mockResolvedValue(unauthorized());
    await expect(listContactMessages()).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("非 admin 返回 forbidden", async () => {
    safelyRequireRoleMock.mockResolvedValue(forbidden());
    await expect(listContactMessages()).resolves.toEqual({ ok: false, error: "forbidden" });
  });

  it("仓库异常返回 databaseError", async () => {
    safelyRequireRoleMock.mockResolvedValue(authed());
    listRecentContactMessagesMock.mockRejectedValue(new Error("boom"));
    await expect(listContactMessages()).resolves.toEqual({ ok: false, error: "databaseError" });
  });

  it("成功返回字段映射后的消息列表", async () => {
    safelyRequireRoleMock.mockResolvedValue(authed());
    listRecentContactMessagesMock.mockResolvedValue([
      {
        id: "m1",
        name: "张三",
        email: "a@b.com",
        subject: "咨询",
        message: "你好",
        created_at: "2026-01-01",
      },
      {
        id: null,
        name: null,
        email: null,
        subject: null,
        message: null,
        created_at: null,
      },
    ]);
    await expect(listContactMessages(5)).resolves.toEqual({
      ok: true,
      data: [
        {
          id: "m1",
          name: "张三",
          email: "a@b.com",
          subject: "咨询",
          message: "你好",
          status: "new",
          created_at: "2026-01-01",
        },
        { id: "null", name: "", email: "", subject: "", message: "", status: "new", created_at: "" },
      ],
    });
    expect(listRecentContactMessagesMock).toHaveBeenCalledWith(5);
  });
});

describe("listContactMessagesPage()", () => {
  it("未登录返回 notAuthenticated", async () => {
    safelyRequireRoleMock.mockResolvedValue(unauthorized());
    await expect(listContactMessagesPage({})).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("成功返回映射行与总数", async () => {
    safelyRequireRoleMock.mockResolvedValue(authed());
    listPageMock.mockResolvedValue({
      rows: [{ id: "m1", name: "A", email: "a@b.c", subject: "s", message: "m", status: "new", created_at: "2026-01-01" }],
      total: 1,
    });
    await expect(listContactMessagesPage({ status: "new", page: 1 })).resolves.toEqual({
      ok: true,
      data: {
        rows: [{ id: "m1", name: "A", email: "a@b.c", subject: "s", message: "m", status: "new", created_at: "2026-01-01" }],
        total: 1,
      },
    });
    expect(listPageMock).toHaveBeenCalledWith({ status: "new", page: 1 });
  });

  it("非法参数返回 invalidInput", async () => {
    safelyRequireRoleMock.mockResolvedValue(authed());
    listPageMock.mockRejectedValue(new Error("invalid_status:bogus"));
    await expect(listContactMessagesPage({})).resolves.toEqual({
      ok: false,
      error: "invalidInput",
    });
  });

  it("仓库异常返回 databaseError", async () => {
    safelyRequireRoleMock.mockResolvedValue(authed());
    listPageMock.mockRejectedValue(new Error("boom"));
    await expect(listContactMessagesPage({})).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });
});

describe("updateMessageStatus()", () => {
  it("未登录返回 notAuthenticated", async () => {
    safelyRequireRoleMock.mockResolvedValue(unauthorized());
    await expect(updateMessageStatus("m1", "resolved")).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("非 admin 返回 forbidden", async () => {
    safelyRequireRoleMock.mockResolvedValue(forbidden());
    await expect(updateMessageStatus("m1", "resolved")).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("成功更新并 revalidate", async () => {
    safelyRequireRoleMock.mockResolvedValue(authed());
    setMessageStatusMock.mockResolvedValue(undefined);
    await expect(updateMessageStatus("m1", "in_progress")).resolves.toEqual({ ok: true });
    expect(setMessageStatusMock).toHaveBeenCalledWith("m1", "in_progress");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/admin/messages");
  });

  it("非法流转返回 invalidTransition", async () => {
    safelyRequireRoleMock.mockResolvedValue(authed());
    setMessageStatusMock.mockRejectedValue(new Error("invalid_transition:resolved->new"));
    await expect(updateMessageStatus("m1", "new")).resolves.toEqual({
      ok: false,
      error: "invalidTransition",
    });
  });

  it("仓库异常返回 databaseError", async () => {
    safelyRequireRoleMock.mockResolvedValue(authed());
    setMessageStatusMock.mockRejectedValue(new Error("boom"));
    await expect(updateMessageStatus("m1", "resolved")).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });
});