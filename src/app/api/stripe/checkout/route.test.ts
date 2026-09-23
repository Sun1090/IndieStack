/**
 * /api/stripe/checkout 的读取失败契约（C08-c）
 *
 * 这一路原先零单测，而它的故障方向是**放行**：读不到归属就跳过 scope 检查，
 * 于是「已经有有效订阅的团队」被允许再买一份。所以每条故障用例都断言两件事：
 * 状态码是 503，以及 `createCheckoutSession` 一次都没被调用。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { checkMock, safelyRequireAuthMock, createClientMock, createCheckoutSessionMock, logApiErrorMock } =
  vi.hoisted(() => ({
    checkMock: vi.fn(),
    safelyRequireAuthMock: vi.fn(),
    createClientMock: vi.fn(),
    createCheckoutSessionMock: vi.fn(),
    logApiErrorMock: vi.fn(async () => {}),
  }));

vi.mock("@/lib/rate-limit", () => ({ rateLimit: { check: checkMock } }));
vi.mock("@/lib/auth/guards", () => ({ safelyRequireAuth: safelyRequireAuthMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: () => true,
  createCheckoutSession: createCheckoutSessionMock,
}));
vi.mock("@/lib/api-log", () => ({ logApiError: logApiErrorMock }));

import { POST } from "./route";

type Read = { data?: unknown; error?: { message: string } | null };

/** 按「表名 + 该表第几次读取」预置结果；链必须可 `await`（页面直接 await 它）。 */
function fakeClient(reads: Record<string, Read[]>) {
  const seen = new Map<string, number>();
  const forTable = (table: string) => {
    const builder: Record<string, unknown> = {};
    const step = () => {
      const index = seen.get(table) ?? 0;
      seen.set(table, index + 1);
      return Promise.resolve(reads[table]?.[index] ?? { data: null, error: null });
    };
    for (const method of ["select", "eq", "in", "order", "limit"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.maybeSingle = vi.fn(step);
    builder.then = (onFulfilled: (value: Read) => unknown) => step().then(onFulfilled);
    return builder;
  };
  const client = { from: vi.fn(forTable) };
  createClientMock.mockResolvedValue(client);
  return client;
}

function post() {
  return POST(
    new NextRequest("http://localhost/api/stripe/checkout", {
      method: "POST",
      body: JSON.stringify({ priceId: "price_pro" }),
    }),
  );
}

const OWN_TEAM: Record<string, Read[]> = {
  team_members: [{ data: { team_id: "t1" } }],
  subscriptions: [{ data: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
  checkMock.mockResolvedValue({ allowed: true, remaining: 9, resetIn: 60_000 });
  safelyRequireAuthMock.mockResolvedValue({ success: true, data: { id: "u1", email: "a@b.c" } });
  createCheckoutSessionMock.mockResolvedValue({ url: "https://checkout.stripe.com/cs_1" });
});

describe("POST /api/stripe/checkout 的两处读取", () => {
  it("团队归属读失败回 503，并且一次会话都不建", async () => {
    fakeClient({
      team_members: [{ data: null, error: { message: "connection terminated" } }],
    });
    const response = await post();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("checkoutUnavailable");
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("确实没有归属（个人用户）时照常发起结账，且不带 teamId", async () => {
    fakeClient({ team_members: [{ data: null }], subscriptions: [{ data: null }] });
    const response = await post();
    expect(response.status).toBe(200);
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1);
    expect(createCheckoutSessionMock.mock.calls[0][1]).not.toHaveProperty("teamId", "t1");
  });

  it("现有订阅读失败回 503，而不是让已有订阅的团队再买一份", async () => {
    fakeClient({
      team_members: [{ data: { team_id: "t1" } }],
      subscriptions: [{ data: null, error: { message: "could not parse response" } }],
    });
    const response = await post();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("checkoutUnavailable");
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("团队已有有效订阅时仍然是 409（那是合法的终态，不是故障）", async () => {
    fakeClient({
      ...OWN_TEAM,
      subscriptions: [{ data: { id: "sub_1" } }],
    });
    const response = await post();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("alreadySubscribed");
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("未登录回 401（守卫的语义没有被这批改动带偏）", async () => {
    safelyRequireAuthMock.mockResolvedValue({
      success: false,
      error: { message: "no session" },
    });
    fakeClient(OWN_TEAM);
    const response = await post();
    expect(response.status).toBe(401);
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });
});
