/**
 * 登录回调路由测试（C09）
 * 覆盖：缺 code 直接放行、交换失败回登录页、交换成功写审计；
 * 重点是最后一档——交换**已经成功**之后再读会话却失败时，审计行必须说得出这是「没读到」，
 * 而不是长得像一次没有主人的登录。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { createClientMock, appendAuditLogMock, recordCurrentSessionMock, logApiErrorMock } =
  vi.hoisted(() => ({
    createClientMock: vi.fn(),
    appendAuditLogMock: vi.fn(),
    recordCurrentSessionMock: vi.fn(),
    logApiErrorMock: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/repositories/audit-logs", () => ({ appendAuditLog: appendAuditLogMock }));
vi.mock("@/lib/actions/sessions", () => ({ recordCurrentSession: recordCurrentSessionMock }));
vi.mock("@/lib/api-log", () => ({ logApiError: logApiErrorMock }));

import { GET } from "./route";

function mockAuth(opts: {
  exchangeError?: object | null;
  user?: { id: string } | null;
  getUserError?: object | null;
}) {
  createClientMock.mockResolvedValue({
    auth: {
      exchangeCodeForSession: vi
        .fn()
        .mockResolvedValue({ data: {}, error: opts.exchangeError ?? null }),
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user ?? null },
        error: opts.getUserError ?? null,
      }),
    },
  });
}

function req(query = "") {
  return new NextRequest(`https://app.example.com/api/auth/callback${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  recordCurrentSessionMock.mockResolvedValue(undefined);
});

describe("GET /api/auth/callback", () => {
  it("没有 code 时不读会话、不写审计，直接跳仪表盘", async () => {
    mockAuth({});
    const res = await GET(req());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.example.com/dashboard");
    expect(appendAuditLogMock).not.toHaveBeenCalled();
  });

  it("交换失败时回登录页，不写审计、也不登记设备", async () => {
    mockAuth({ exchangeError: { message: "invalid code" } });
    const res = await GET(req("?code=c1"));
    expect(res.headers.get("location")).toBe("https://app.example.com/auth/login");
    expect(appendAuditLogMock).not.toHaveBeenCalled();
    expect(recordCurrentSessionMock).not.toHaveBeenCalled();
  });

  it("交换成功：审计落在这次登录的用户上，metadata 不带失败标记", async () => {
    mockAuth({ user: { id: "u1" } });
    const res = await GET(req("?code=c1&next=%2Fdashboard%2Fprofile"));
    expect(res.headers.get("location")).toBe("https://app.example.com/dashboard/profile");
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        entityId: "u1",
        action: "auth.oauth_login",
        metadata: { method: "oauth" },
      }),
    );
  });

  it("交换成功但会话读不出来：审计照写，metadata 标出 sessionReadFailed", async () => {
    mockAuth({ user: null, getUserError: { message: "auth unavailable" } });
    const res = await GET(req("?code=c1"));
    // 跳转方向不变：会话已经在浏览器里了，拦一次已经成功的登录不是这条路由的职责
    expect(res.headers.get("location")).toBe("https://app.example.com/dashboard");
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        action: "auth.oauth_login",
        metadata: { method: "oauth", sessionReadFailed: true },
      }),
    );
    expect(logApiErrorMock).toHaveBeenCalled();
  });
});
