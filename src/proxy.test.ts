/**
 * Middleware 路由守卫测试
 * 覆盖：Mock 直通、未登录保护路由重定向、已登录访问认证页重定向、公开路由直通
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { proxy } from "./proxy";

const shouldUseMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/lib/mock/config", () => ({ shouldUseMock }));

type Session = { supabase: unknown; supabaseResponse: NextResponse; user: unknown };
const updateUser: { user: unknown } = { user: null };

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(async (): Promise<Session> => ({
    supabase: {},
    supabaseResponse: NextResponse.next(),
    user: updateUser.user,
  })),
}));

function makeRequest(path: string) {
  return new NextRequest(`http://localhost:3000${path}`);
}

beforeEach(() => {
  shouldUseMock.mockReturnValue(false);
  updateUser.user = null;
});

describe("proxy()", () => {
  it("Mock 模式下跳过所有权限检查", async () => {
    shouldUseMock.mockReturnValue(true);
    const res = await proxy(makeRequest("/dashboard"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("未登录访问 /dashboard 重定向到登录页并携带 redirect 参数", async () => {
    const res = await proxy(makeRequest("/dashboard"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/login");
    expect(location.searchParams.get("redirect")).toBe("/dashboard");
  });

  it("未登录访问 dashboard 子路由同样被保护", async () => {
    const res = await proxy(makeRequest("/dashboard/team/invite"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).searchParams.get("redirect")).toBe(
      "/dashboard/team/invite",
    );
  });

  it("已登录用户访问登录页重定向到 dashboard", async () => {
    updateUser.user = { id: "u1" };
    const res = await proxy(makeRequest("/auth/login"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("已登录用户访问注册页同样重定向", async () => {
    updateUser.user = { id: "u1" };
    const res = await proxy(makeRequest("/auth/register"));
    expect(res.status).toBe(307);
  });

  it("已登录访问 dashboard 正常放行", async () => {
    updateUser.user = { id: "u1" };
    const res = await proxy(makeRequest("/dashboard"));
    expect(res.status).toBe(200);
  });

  it("公开营销路由不受保护（无论是否登录）", async () => {
    for (const path of ["/", "/pricing", "/blog"]) {
      const res = await proxy(makeRequest(path));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });
});
