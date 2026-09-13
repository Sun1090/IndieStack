/**
 * Middleware 路由守卫与链路追踪测试
 * 覆盖：Mock 直通、未登录保护路由重定向、已登录访问认证页重定向、公开路由直通，
 * 以及 E02 的 x-request-id 契约（生成/透传/注入请求头/回写响应头）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { proxy } from "./proxy";
import { TRACE_HEADER } from "@/lib/trace-id";

const shouldUseMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/lib/mock/config", () => ({ shouldUseMock }));

type Session = { supabase: unknown; supabaseResponse: NextResponse; user: unknown };
const updateUser: { user: unknown } = { user: null };
const updateSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/middleware", () => ({ updateSession: updateSessionMock }));

function makeRequest(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

beforeEach(() => {
  shouldUseMock.mockReturnValue(false);
  updateUser.user = null;
  updateSessionMock.mockReset();
  updateSessionMock.mockImplementation(
    async (): Promise<Session> => ({
      supabase: {},
      supabaseResponse: NextResponse.next(),
      user: updateUser.user,
    }),
  );
});

/** proxy 传给 updateSession 的请求（即会被下游 Server Component / Action 读取的请求头）。 */
function forwardedRequest(index = 0): NextRequest {
  return updateSessionMock.mock.calls[index][0] as NextRequest;
}

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

describe("proxy() x-request-id 契约（E02）", () => {
  it("无上游 ID 时生成新 ID 并注入下游请求头", async () => {
    await proxy(makeRequest("/pricing"));
    const generated = forwardedRequest().headers.get(TRACE_HEADER);
    expect(generated).toBeTruthy();
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("透传合法上游 ID（归一化首尾空白）", async () => {
    await proxy(makeRequest("/pricing", { [TRACE_HEADER]: "  upstream-trace-1  " }));
    expect(forwardedRequest().headers.get(TRACE_HEADER)).toBe("upstream-trace-1");
  });

  it("拒绝非法字符的上游 ID 并改用生成值", async () => {
    // 空格在 HTTP header 里合法，但不是合法 trace-id，必须被归一化流程丢弃
    await proxy(makeRequest("/pricing", { [TRACE_HEADER]: "bad trace id" }));
    const id = forwardedRequest().headers.get(TRACE_HEADER);
    expect(id).not.toBe("bad trace id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("拒绝超长上游 ID 并改用生成值", async () => {
    await proxy(makeRequest("/pricing", { [TRACE_HEADER]: "a".repeat(200) }));
    const id = forwardedRequest().headers.get(TRACE_HEADER);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("回写响应头，值与被注入的请求头一致", async () => {
    const res = await proxy(makeRequest("/pricing"));
    expect(res.headers.get(TRACE_HEADER)).toBe(forwardedRequest().headers.get(TRACE_HEADER));
  });

  it("保护路由重定向同样回写 trace-id", async () => {
    const res = await proxy(makeRequest("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get(TRACE_HEADER)).toBe(forwardedRequest().headers.get(TRACE_HEADER));
  });

  it("已登录跳转 dashboard 的重定向同样回写 trace-id", async () => {
    updateUser.user = { id: "u1" };
    const res = await proxy(makeRequest("/auth/login"));
    expect(res.status).toBe(307);
    expect(res.headers.get(TRACE_HEADER)).toBeTruthy();
  });

  it("CSP nonce 与 trace-id 互不覆盖", async () => {
    const res = await proxy(makeRequest("/pricing"));
    expect(res.headers.get("Content-Security-Policy")).toContain("nonce-");
    expect(res.headers.get(TRACE_HEADER)).toBeTruthy();
    expect(forwardedRequest().headers.get("x-nonce")).toBeTruthy();
  });
});
