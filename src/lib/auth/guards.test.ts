/**
 * 路由守卫单元测试
 * mock next/navigation 与 supabase server client，验证认证/角色/权限守卫逻辑
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ROUTES } from "@/lib/constants";

const { createClientMock, redirectMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import {
  AuthGuardError,
  UNAUTHORIZED,
  FORBIDDEN,
  requireAuth,
  requireRole,
  requirePermission,
  safelyRequireAuth,
  safelyRequirePermission,
  safelyRequireRole,
  guardHttpStatus,
  type AuthUser,
} from "./guards";

/** 构造 mock supabase 客户端 */
function mockSupabase(
  overrides: {
    user?: { id: string; email?: string | null } | null;
    profileRole?: string | null;
    getUserError?: boolean;
  } = {},
) {
  const {
    user = { id: "u1", email: "a@b.com" },
    profileRole = "member",
    getUserError = false,
  } = overrides;

  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue(
          getUserError ? Promise.reject(new Error("network")) : { data: { user } },
        ),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: profileRole ? { role: profileRole } : null }),
        }),
      }),
    }),
  };
}

const adminUser: AuthUser = { id: "u1", email: "a@b.com", role: "admin" };

beforeEach(() => {
  vi.clearAllMocks();
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("requireAuth()", () => {
  it("未登录时重定向到登录页", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ user: null }));
    await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith(ROUTES.login);
  });

  it("已登录时返回用户与角色", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ profileRole: "admin" }));
    await expect(requireAuth()).resolves.toEqual(adminUser);
  });

  it("profile 角色缺失或非法时回退为 member", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ profileRole: null }));
    await expect(requireAuth()).resolves.toEqual({ ...adminUser, role: "member" });

    createClientMock.mockResolvedValue(mockSupabase({ profileRole: "owner" }));
    await expect(requireAuth()).resolves.toEqual({ ...adminUser, role: "member" });
  });
});

describe("requireRole()", () => {
  it("角色不足时抛出 FORBIDDEN", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ profileRole: "viewer" }));
    await expect(requireRole("admin")).rejects.toBe(FORBIDDEN);
  });

  it("角色达标时返回用户", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ profileRole: "admin" }));
    await expect(requireRole("member")).resolves.toEqual(adminUser);
  });
});

describe("requirePermission()", () => {
  it("缺少权限时抛出 FORBIDDEN", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ profileRole: "member" }));
    await expect(requirePermission("team:invite")).rejects.toBe(FORBIDDEN);
  });

  it("具备权限时返回用户", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ profileRole: "member" }));
    await expect(requirePermission("project:write")).resolves.toEqual({
      ...adminUser,
      role: "member",
    });
  });
});

describe("safelyRequireAuth()", () => {
  it("未登录返回 UNAUTHORIZED 结果", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ user: null }));
    const result = await safelyRequireAuth();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(UNAUTHORIZED);
  });

  it("supabase 异常时捕获为 UNAUTHORIZED", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ getUserError: true }));
    const result = await safelyRequireAuth();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(UNAUTHORIZED);
  });

  it("已登录返回用户数据", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ profileRole: "admin" }));
    const result = await safelyRequireAuth();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(adminUser);
  });
});

describe("safelyRequirePermission()", () => {
  it("未登录返回 UNAUTHORIZED", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ user: null }));
    const result = await safelyRequirePermission("project:read");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(UNAUTHORIZED);
  });

  it("缺少权限返回 FORBIDDEN", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ profileRole: "viewer" }));
    const result = await safelyRequirePermission("user:write");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(FORBIDDEN);
  });

  it("具备权限返回用户数据", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ profileRole: "viewer" }));
    const result = await safelyRequirePermission("project:read");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ ...adminUser, role: "viewer" });
  });
});

describe("safelyRequireRole()", () => {
  it("角色不足返回 FORBIDDEN", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ profileRole: "member" }));
    const result = await safelyRequireRole("admin");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(FORBIDDEN);
  });

  it("角色达标返回用户数据", async () => {
    createClientMock.mockResolvedValue(mockSupabase({ profileRole: "admin" }));
    const result = await safelyRequireRole("viewer");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(adminUser);
  });
});

describe("guardHttpStatus()", () => {
  it("UNAUTHORIZED → 401，其他 → 403", () => {
    expect(guardHttpStatus(UNAUTHORIZED)).toBe(401);
    expect(guardHttpStatus(FORBIDDEN)).toBe(403);
    expect(guardHttpStatus(new AuthGuardError("x", "NOT_FOUND"))).toBe(403);
  });
});
