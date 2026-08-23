/**
 * Supabase Middleware 会话管理测试
 * 覆盖：cookie 透传、setAll 刷新后写回响应、Mock 模式短路
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "./middleware";

const mockState = vi.hoisted(() => ({
  shouldUseMock: false,
  user: null as unknown,
  cookiesToSet: [] as { name: string; value: string }[],
}));

vi.mock("@/lib/mock/config", () => ({
  shouldUseMock: () => mockState.shouldUseMock,
}));

// 捕获 createServerClient 收到的 cookie 配置
let captured: {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: { name: string; value: string }[]) => void;
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, config: { cookies: typeof captured }) => {
    captured = config.cookies;
    return {
      auth: {
        // 真实时序：Supabase 在 getUser 过程中刷新 token 并回调 setAll
        getUser: async () => {
          if (mockState.cookiesToSet.length) captured.setAll(mockState.cookiesToSet);
          return { data: { user: mockState.user } };
        },
      },
    };
  }),
}));

function makeRequest(cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest("http://localhost:3000/dashboard", { headers });
}

beforeEach(() => {
  mockState.shouldUseMock = false;
  mockState.user = null;
  mockState.cookiesToSet = [];
});

describe("updateSession()", () => {
  it("请求 cookie 透传给 Supabase 客户端", async () => {
    await updateSession(makeRequest("sb-token=abc"));
    expect(captured.getAll()).toContainEqual({ name: "sb-token", value: "abc" });
  });

  it("setAll 刷新的 cookie 写回响应", async () => {
    mockState.cookiesToSet = [{ name: "sb-access-token", value: "new-token" }];
    const { supabaseResponse } = await updateSession(makeRequest());
    const setCookie = supabaseResponse.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sb-access-token=new-token");
  });

  it("Mock 模式返回模拟用户且不创建 Supabase 客户端", async () => {
    mockState.shouldUseMock = true;
    const result = await updateSession(makeRequest());
    expect(result.user).toBeTruthy();
    expect(result.supabase).toBeNull();
  });

  it("非 Mock 模式返回真实用户状态", async () => {
    mockState.user = { id: "u1" };
    const result = await updateSession(makeRequest());
    expect(result.supabase).not.toBeNull();
    expect(result.user).toEqual({ id: "u1" });
  });
});
