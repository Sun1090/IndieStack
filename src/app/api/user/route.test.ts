/**
 * /api/user 路由测试
 * 覆盖：未认证 401、GET 成功/失败、PATCH 白名单校验与危险协议拦截、DELETE 账号注销
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { RequestInit as NextRequestInit } from "next/dist/server/web/spec-extension/request";
import { GET, PATCH, DELETE } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: { check: vi.fn(async () => ({ allowed: true, remaining: 9, resetIn: 60_000 })) },
}));

type ProfileRow = Record<string, unknown>;

const mockState = vi.hoisted(() => ({
  user: null as { id: string; email?: string; email_confirmed_at?: string | null; created_at?: string } | null,
  profile: { full_name: "Alice" } as ProfileRow | null,
  profileError: null as { message: string } | null,
  updateResult: { data: { full_name: "Bob" } as ProfileRow | null, error: null as { message: string } | null },
  lastUpdatePayload: null as Record<string, unknown> | null,
  deleteError: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mockState.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            Promise.resolve({ data: mockState.profile, error: mockState.profileError }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        mockState.lastUpdatePayload = payload;
        return {
          eq: () => ({
            select: () => ({
              single: async () => Promise.resolve(mockState.updateResult),
            }),
          }),
        };
      },
    }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { deleteUser: async () => ({ error: mockState.deleteError }) } },
  }),
}));

function req(path: string, init?: NextRequestInit) {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.user = { id: "u1", email: "a@b.c", email_confirmed_at: "2026-01-01", created_at: "2026-01-01" };
  mockState.profile = { full_name: "Alice" };
  mockState.profileError = null;
  mockState.updateResult = { data: { full_name: "Bob" }, error: null };
  mockState.lastUpdatePayload = null;
  mockState.deleteError = null;
});

describe("GET /api/user", () => {
  it("未认证返回 401", async () => {
    mockState.user = null;
    const res = await GET(req("/api/user"));
    expect(res.status).toBe(401);
  });

  it("已认证返回用户与 profile", async () => {
    const res = await GET(req("/api/user"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.user.id).toBe("u1");
    expect(body.profile.full_name).toBe("Alice");
  });

  it("profile 查询失败返回 500", async () => {
    mockState.profileError = { message: "db down" };
    const res = await GET(req("/api/user"));
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/user", () => {
  it("拒绝未知字段（strict 白名单）", async () => {
    const res = await PATCH(req("/api/user", { method: "PATCH", body: JSON.stringify({ role: "owner" }) }));
    expect(res.status).toBe(400);
  });

  it("拒绝 javascript: 协议头像", async () => {
    const res = await PATCH(
      req("/api/user", { method: "PATCH", body: JSON.stringify({ avatar_url: "javascript:alert(1)" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("合法更新写入 updated_at 并返回 profile", async () => {
    const res = await PATCH(
      req("/api/user", { method: "PATCH", body: JSON.stringify({ full_name: "Bob" }) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profile: { full_name: "Bob" } });
    expect(mockState.lastUpdatePayload).toMatchObject({ full_name: "Bob" });
    expect(typeof mockState.lastUpdatePayload!.updated_at).toBe("string");
  });

  it("数据库更新失败返回 500", async () => {
    mockState.updateResult = { data: null, error: { message: "rls denied" } };
    const res = await PATCH(req("/api/user", { method: "PATCH", body: JSON.stringify({ bio: "hi" }) }));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/user", () => {
  it("注销成功返回 success", async () => {
    const res = await DELETE(req("/api/user", { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("删除失败返回 500", async () => {
    mockState.deleteError = { message: "admin api error" };
    const res = await DELETE(req("/api/user", { method: "DELETE" }));
    expect(res.status).toBe(500);
  });
});
