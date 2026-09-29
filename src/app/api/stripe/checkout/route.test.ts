/**
 * Stripe Checkout 路由单测
 *
 * 覆盖的是那两道**门禁**读取的失败方向：读不到团队 / 读不到现有订阅时，必须拒绝这次结账。
 * 放行不是「少了个检查」——它会同时 (1) 让重复订阅穿过 scope 检查、
 * (2) 把 `teamId: undefined` 写进会话 metadata，于是钱照收而 webhook 认不出订阅归属哪个团队。
 * 另一条管的是这些失败**说给人听的那半句**：响应里的 `error` 会被当成 i18n 键直接渲染。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ROUTE = "src/app/api/stripe/checkout/route.ts";

const { createSessionMock, logApiErrorMock, fromMock, requireAuthMock } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  logApiErrorMock: vi.fn(),
  fromMock: vi.fn(),
  requireAuthMock: vi.fn(),
}));

vi.mock("@/lib/api-log", () => ({ logApiError: logApiErrorMock }));
vi.mock("@/lib/auth/guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/guards")>()),
  safelyRequireAuth: requireAuthMock,
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: { check: async () => ({ allowed: true, resetIn: 1 }) },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: fromMock }) }));
vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: () => true,
  createCheckoutSession: createSessionMock,
}));

import { POST } from "./route";

/** 查询链 mock：链式方法返回自身，终点按设定值解析。 */
function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  return builder;
}

function post(priceId = "price_pro_monthly") {
  return POST(
    new NextRequest("https://indiestack.test/api/stripe/checkout", {
      method: "POST",
      body: JSON.stringify({ priceId }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({
    success: true,
    data: { id: "u1", email: "a@b.com", role: "member" },
  });
  createSessionMock.mockResolvedValue({ url: "https://checkout.stripe.test/cs_1" });
  // 默认：有团队、没有进行中的订阅
  fromMock.mockImplementation((table: string) =>
    table === "team_members"
      ? chain({ data: { team_id: "t1" }, error: null })
      : chain({ data: null, error: null }),
  );
});

describe("POST /api/stripe/checkout", () => {
  /**
   * 守卫失败有三种，三种说给人听的句子必须不同。
   * 改之前这里只有一条 `401 + notAuthenticated`，于是「我们没读到会话」被答成「你没登录」——
   * 客户端据此把这次结账当成身份问题，而重新登录并不会让那次读取成功。
   */
  it("确认没登录：401 + notAuthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      success: false,
      error: Object.assign(new Error("no session"), { code: "UNAUTHORIZED" }),
    });
    const response = await post();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "notAuthenticated" });
  });

  it("权限不足：403 + notAuthenticated（结账端点只要求登录，不区分 FORBIDDEN）", async () => {
    requireAuthMock.mockResolvedValue({
      success: false,
      error: Object.assign(new Error("nope"), { code: "FORBIDDEN" }),
    });
    const response = await post();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "notAuthenticated" });
  });

  it("会话读失败：503 + authUnavailable，绝不是 401", async () => {
    // 反向证据：只有这一条能证伪「一律 401」也能骗过上面那两条。
    requireAuthMock.mockResolvedValue({
      success: false,
      error: Object.assign(new Error("Failed to fetch"), {
        code: "SERVICE_UNAVAILABLE",
      }),
    });
    const response = await post();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "authUnavailable" });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("两道门禁读取都正常时创建会话并带上团队归属", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledWith(
      "price_pro_monthly",
      expect.objectContaining({ userId: "u1", teamId: "t1" }),
    );
  });

  it("团队归属读失败时 503，且不创建会话", async () => {
    fromMock.mockImplementation(() =>
      chain({ data: null, error: Object.assign(new Error("boom"), { code: "42501" }) }),
    );

    const response = await post();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "checkoutUnavailable" });
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(logApiErrorMock).toHaveBeenCalledWith(
      "[Stripe Checkout] 团队归属读取失败",
      expect.any(Error),
    );
  });

  it("现有订阅读失败时 503，而不是当作「没有订阅」放行重复购买", async () => {
    fromMock.mockImplementation((table: string) =>
      table === "team_members"
        ? chain({ data: { team_id: "t1" }, error: null })
        : chain({ data: null, error: new Error("connection terminated") }),
    );

    const response = await post();
    expect(response.status).toBe(503);
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(logApiErrorMock).toHaveBeenCalledWith(
      "[Stripe Checkout] 现有订阅读取失败",
      expect.any(Error),
    );
  });

  it("已有有效订阅仍然拒绝为 409，读不到与查不到是两件事", async () => {
    fromMock.mockImplementation((table: string) =>
      table === "team_members"
        ? chain({ data: { team_id: "t1" }, error: null })
        : chain({ data: { id: "sub_1" }, error: null }),
    );

    const response = await post();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "alreadySubscribed" });
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(logApiErrorMock).not.toHaveBeenCalled();
  });

  it("团队里没有进行中的订阅时放行，且没有订阅也记不出一条错误", async () => {
    fromMock.mockImplementation((table: string) =>
      table === "team_members"
        ? chain({ data: { team_id: "t1" }, error: null })
        : chain({ data: null, error: null }),
    );

    const response = await post();
    expect(response.status).toBe(200);
    expect(logApiErrorMock).not.toHaveBeenCalled();
  });

  it("用户不属于任何团队时按个人订阅放行，且不去查订阅表", async () => {
    // 没有团队 → 「已有有效订阅」这道检查无从谈起：既不能查 subscriptions，也不能把
    // 一次注定查不到东西的读取当成门禁失败，否则所有个人用户都会被 503 挡在结账外。
    fromMock.mockImplementation(() => chain({ data: null, error: null }));

    const response = await post();
    expect(response.status).toBe(200);
    expect(fromMock.mock.calls.flat()).not.toContain("subscriptions");
    expect(createSessionMock).toHaveBeenCalledWith(
      "price_pro_monthly",
      expect.objectContaining({ teamId: undefined }),
    );
    expect(logApiErrorMock).not.toHaveBeenCalled();
  });

  it("路由能返回的每个错误码都在两个 locale 里有文案", () => {
    // `checkout-button.tsx` 把响应里的 `error` 直接当 i18n 键用（`ta(payload.error ?? …)`），
    // 而动态键在构建期查不出来：`alreadySubscribed` 从 2026-09-03 起就在这个路由上，
    // `messages/` 里却从来没有过它（`git log -S alreadySubscribed -- messages/` 为空）。
    // `pnpm check:i18n` 只扫静态调用点，摸不到这种键——这条测试是该缺陷目前唯一的自动化拦网。
    const source = readFileSync(path.join(process.cwd(), ROUTE), "utf8");
    const codes = [
      ...new Set(
        [...source.matchAll(/jsonNoStore\(\s*\{\s*error:\s*"([a-z][A-Za-z]+)"/g)].map((m) => m[1]),
      ),
    ].sort();
    // 地板值：正则一旦失效，「零缺失」就只是「什么都没在看」。
    expect(codes.length).toBeGreaterThanOrEqual(10);
    for (const locale of ["en", "zh-CN"]) {
      const messages = JSON.parse(
        readFileSync(path.join(process.cwd(), "messages", locale, "actions.json"), "utf8"),
      ) as Record<string, string>;
      for (const code of codes) {
        expect(messages[code], `${locale} 缺 actions.${code}（${codes.length} 个码之一）`).toBeTruthy();
      }
    }
    // 反向：加了码又不登记，这里必须点名，而不是只报「少了一个键」。
    // 新增守卫「我们没读到」那条分支时改过地板值：9 → 10。写 9 的话那个三元形状会让这条
    // 测试自己红（它读不到三元里的键），而「让判据保持原样、让代码迁就判据」是这里想要的。
    expect(codes).toContain("authUnavailable");
    expect(codes).toContain("checkoutUnavailable");
    expect(codes).toContain("alreadySubscribed");
  });
});
