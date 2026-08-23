/**
 * /api/analytics 路由测试
 * 覆盖：未认证 401、range 边界钳制、时间序列/错误率聚合、异常兜底 500
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: { check: vi.fn(async () => ({ allowed: true, remaining: 9, resetIn: 60_000 })) },
}));

const mockState = vi.hoisted(() => ({
  authSuccess: true,
  userId: "u1",
  rows: [] as Array<{ created_at: string; status_code: number | null; user_id: string | null; path: string; method: string }>,
  count: 0,
  shouldThrow: false,
}));

vi.mock("@/lib/auth/guards", () => ({
  safelyRequireAuth: async () =>
    mockState.authSuccess ? { success: true, data: { id: mockState.userId } } : { success: false, error: { message: "Not authenticated" } },
}));

function makeDetailChain() {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    order: vi.fn(async () => ({ data: mockState.rows })),
  };
  return chain;
}

// from("api_usage") 第一次调用是 head 计数（返回 { count }），第二次是明细查询
const headCountChain = {
  calls: 0,
  count: 0,
  buildHead() {
    const self: Record<string, unknown> = {};
    const terminal = async () => ({ count: this.count });
    ["select", "eq", "gte"].forEach((m) => (self[m] = () => this.buildHead()));
    Object.assign(self, { then: (resolve: (v: unknown) => void) => terminal().then(resolve) });
    return self as never;
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (mockState.shouldThrow) throw new Error("boom");
    return {
      from: () => {
        headCountChain.calls += 1;
        if (headCountChain.calls % 2 === 1) return headCountChain.buildHead();
        return makeDetailChain();
      },
    };
  },
}));

beforeEach(() => {
  mockState.authSuccess = true;
  mockState.shouldThrow = false;
  mockState.rows = [];
  headCountChain.calls = 0;
  headCountChain.count = 0;
});

describe("GET /api/analytics", () => {
  it("未认证返回 401", async () => {
    mockState.authSuccess = false;
    const res = await GET(new NextRequest("http://localhost/api/analytics"));
    expect(res.status).toBe(401);
  });

  it("range 钳制到 1-90 区间并回显", async () => {
    for (const [input, expected] of [
      ["500", 90],
      ["0", 30],
      ["abc", 30],
      ["14", 14],
    ] as const) {
      const res = await GET(new NextRequest(`http://localhost/api/analytics?range=${input}`));
      const body = await res.json();
      expect(body.range).toBe(expected);
    }
  });

  it("聚合请求数与错误率", async () => {
    headCountChain.count = 4;
    const today = new Date().toISOString().slice(0, 10);
    mockState.rows = [
      { created_at: `1999-01-01T00:00:00Z`, status_code: 500, user_id: "u1", path: "/old", method: "GET" }, // 窗口外不计入
      { created_at: `${today}T01:00:00Z`, status_code: 200, user_id: "u1", path: "/a", method: "GET" },
      { created_at: `${today}T02:00:00Z`, status_code: 500, user_id: "u1", path: "/b", method: "POST" },
    ];

    const res = await GET(new NextRequest("http://localhost/api/analytics?range=7"));
    const body = await res.json();

    expect(body.summary.totalRequests).toBe(4);
    expect(body.summary.totalErrors).toBe(1); // 窗口外的旧错误不累计
    expect(body.summary.errorRate).toBe(25.0);
    expect(body.summary.uniqueVisitors).toBe(1);
    expect(body.timeline).toHaveLength(7);
    const todayEntry = body.timeline.find((t: { date: string }) => t.date === today);
    expect(todayEntry).toMatchObject({ requests: 2, errors: 1 });
    expect(body.recent[0].path).toBe("/b"); // 最近记录倒序
  });

  it("Supabase 异常返回 500 兜底", async () => {
    mockState.shouldThrow = true;
    const res = await GET(new NextRequest("http://localhost/api/analytics"));
    expect(res.status).toBe(500);
  });
});
