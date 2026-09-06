/**
 * 审计事件操作单测（C04 测试职责）
 * mock server client、rate-limit 与 audit-logs 仓库，验证审计永不阻断主流程
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClientMock, rateLimitCheckMock, appendAuditLogMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  rateLimitCheckMock: vi.fn(),
  appendAuditLogMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: { check: rateLimitCheckMock } }));
vi.mock("@/lib/repositories/audit-logs", () => ({ appendAuditLog: appendAuditLogMock }));

import { logAuthEvent } from "./audit";

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitCheckMock.mockResolvedValue({ allowed: true, remaining: 9, resetIn: 1000 });
});

function mockUser(user: object | null) {
  createClientMock.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  });
}

describe("logAuthEvent()", () => {
  it("登录成功记录用户 ID", async () => {
    mockUser({ id: "u1", email: "a@b.com" });
    await expect(logAuthEvent("auth.login", { method: "password" })).resolves.toEqual({
      ok: true,
    });
    expect(appendAuditLogMock).toHaveBeenCalledWith({
      userId: "u1",
      action: "auth.login",
      entityType: "auth",
      entityId: "u1",
      metadata: { method: "password" },
    });
  });

  it("失败登录无会话时 userId 置空", async () => {
    mockUser(null);
    await expect(logAuthEvent("auth.login_failed", { email: "x@y.com" })).resolves.toEqual({
      ok: true,
    });
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, action: "auth.login_failed" }),
    );
  });

  it("限频时跳过写入仍返回 ok", async () => {
    rateLimitCheckMock.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 1000 });
    mockUser({ id: "u1" });
    await expect(logAuthEvent("auth.login")).resolves.toEqual({ ok: true });
    expect(appendAuditLogMock).not.toHaveBeenCalled();
  });

  it("保留普通 metadata 并脱敏顶层敏感字段", async () => {
    mockUser({ id: "u1" });
    await logAuthEvent("auth.login", {
      email: "a@b.com",
      method: "password",
      password: "hunter2",
      access_token: "access-secret",
      verification_code: "123456",
    });

    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          email: "a@b.com",
          method: "password",
          password: "[REDACTED]",
          access_token: "[REDACTED]",
          verification_code: "[REDACTED]",
        },
      }),
    );
  });

  it("递归脱敏嵌套对象、数组并处理循环引用", async () => {
    mockUser({ id: "u1" });
    const nested: Record<string, unknown> = {
      factorId: "factor-1",
      secret: "nested-secret",
      attempts: [{ code: "654321", result: "failed" }],
    };
    nested.self = nested;

    await logAuthEvent("auth.mfa_verified", nested);

    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          factorId: "factor-1",
          secret: "[REDACTED]",
          attempts: [{ code: "[REDACTED]", result: "failed" }],
          self: "[REDACTED]",
        },
      }),
    );
  });

  it("仓库异常吞错仍返回 ok（不阻断登录）", async () => {
    mockUser({ id: "u1" });
    appendAuditLogMock.mockRejectedValue(new Error("boom"));
    await expect(logAuthEvent("auth.login")).resolves.toEqual({ ok: true });
  });
});
