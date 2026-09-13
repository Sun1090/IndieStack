/**
 * Stripe Webhook 路由单测（H06 幂等）
 * 覆盖：幂等占位门禁、重复投递不重放副作用、失败可重试、非 2xx 语义。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { claimMock, finalizeMock, notifyUserMock, logApiErrorMock, adminFromMock } = vi.hoisted(
  () => ({
    claimMock: vi.fn(),
    finalizeMock: vi.fn(),
    notifyUserMock: vi.fn(),
    logApiErrorMock: vi.fn(),
    adminFromMock: vi.fn(),
  }),
);

vi.mock("@/lib/repositories/webhook-events", () => ({
  claimWebhookEvent: claimMock,
  finalizeWebhookEvent: finalizeMock,
}));
vi.mock("@/lib/email-notify", () => ({ notifyUser: notifyUserMock }));
vi.mock("@/lib/api-log", () => ({ logApiError: logApiErrorMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: adminFromMock }),
}));
vi.mock("@/lib/stripe", () => ({
  getStripeServer: async () => ({
    webhooks: { constructEvent: () => CURRENT_EVENT },
  }),
}));

import { POST } from "./route";

let CURRENT_EVENT: Record<string, unknown>;

/** 查询链 mock：await chain → 设定结果；链式方法返回自身 */
function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "update", "upsert"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return builder;
}

function pgError(message: string) {
  return Object.assign(new Error(message), { code: "42501", hint: "GRANT ..." });
}

function event(id: string, type: string, object: Record<string, unknown> = {}) {
  return { id, type, data: { object } };
}

function post(body = "{}", signature: string | null = "t=1,v1=valid") {
  const headers = new Headers();
  if (signature) headers.set("stripe-signature", signature);
  return POST(new Request("https://indiestack.test/api/webhooks/stripe", { method: "POST", headers, body }));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  claimMock.mockResolvedValue({ outcome: "claimed", attempts: 1 });
  finalizeMock.mockResolvedValue(undefined);
  adminFromMock.mockReturnValue(chain({ data: null, error: null }));
});

describe("POST /api/webhooks/stripe 请求边界", () => {
  it("缺少签名头时 400 且不占位", async () => {
    const response = await post("{}", null);
    expect(response.status).toBe(400);
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("缺少 STRIPE_WEBHOOK_SECRET 时 500", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const response = await post();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Webhook not configured" });
  });
});

describe("POST /api/webhooks/stripe 幂等门禁", () => {
  it("重复投递回 200 duplicate 且不重放副作用", async () => {
    CURRENT_EVENT = event("evt_dup", "customer.subscription.created", { id: "sub_1", items: { data: [] } });
    claimMock.mockResolvedValue({ outcome: "duplicate", attempts: 2 });

    const response = await post();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, duplicate: true });
    // 关键断言：重复投递不得触碰订阅表，也不得发通知
    expect(adminFromMock).not.toHaveBeenCalled();
    expect(notifyUserMock).not.toHaveBeenCalled();
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("占位失败回 500 让 Stripe 重试且不执行副作用", async () => {
    CURRENT_EVENT = event("evt_claim_fail", "customer.subscription.created", { id: "sub_1" });
    claimMock.mockRejectedValue(new Error("db down"));

    const response = await post();
    expect(response.status).toBe(500);
    expect(adminFromMock).not.toHaveBeenCalled();
    expect(finalizeMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/stripe 事件分支", () => {
  it("首次订阅事件写 subscriptions 并落定 processed", async () => {
    CURRENT_EVENT = event("evt_sub", "customer.subscription.created", {
      id: "sub_1",
      status: "active",
      cancel_at_period_end: false,
      metadata: { teamId: "team_1" },
      items: { data: [{ price: { id: "price_pro" }, current_period_start: 1, current_period_end: 2 }] },
    });
    const subscriptions = chain({ data: null, error: null });
    adminFromMock.mockReturnValue(subscriptions);

    const response = await post();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ team_id: "team_1", provider_id: "sub_1", provider: "stripe" }),
      { onConflict: "provider_id" },
    );
    expect(finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: "evt_sub", status: "processed" }),
    );
  });

  it("付款成功通知 owner 并落定 skipped", async () => {
    CURRENT_EVENT = event("evt_paid", "invoice.payment_succeeded", {
      id: "in_1",
      parent: { subscription_details: { subscription: "sub_1" } },
    });
    adminFromMock.mockImplementation((table: string) =>
      table === "subscriptions"
        ? chain({ data: { team_id: "team_1" } })
        : chain({ data: { user_id: "user_1" } }),
    );

    const response = await post();
    expect(response.status).toBe(200);
    expect(notifyUserMock).toHaveBeenCalledTimes(1);
    expect(notifyUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1", type: "payment_succeeded" }),
    );
    expect(finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: "evt_paid", status: "skipped" }),
    );
  });

  it("未知事件类型落 skipped 且不 500", async () => {
    CURRENT_EVENT = event("evt_unknown", "customer.discount.created", { id: "di_1" });

    const response = await post();
    expect(response.status).toBe(200);
    expect(finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: "evt_unknown", status: "skipped" }),
    );
  });
});

describe("POST /api/webhooks/stripe 失败路径", () => {
  it("副作用失败标记 failed 并回 500，供 Stripe 重试重新占位", async () => {
    CURRENT_EVENT = event("evt_fail", "customer.subscription.created", {
      id: "sub_1",
      status: "active",
      metadata: { teamId: "team_1" },
      items: { data: [] },
    });
    adminFromMock.mockReturnValue(chain({ data: null, error: pgError("boom") }));

    const response = await post();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Webhook handler failed" });
    expect(finalizeMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ event_id: "evt_fail", status: "failed", error_message: "boom" }),
    );
  });

  it("失败状态本身写不进去时仍回 500 不抛错", async () => {
    CURRENT_EVENT = event("evt_fail2", "customer.subscription.created", {
      id: "sub_1",
      status: "active",
      metadata: { teamId: "team_1" },
      items: { data: [] },
    });
    adminFromMock.mockReturnValue(chain({ data: null, error: pgError("boom") }));
    finalizeMock.mockRejectedValue(new Error("finalize down"));

    const response = await post();
    expect(response.status).toBe(500);
    expect(logApiErrorMock).toHaveBeenCalledWith(
      "[Stripe Webhook] 事件失败状态写入失败",
      expect.any(Error),
    );
  });

  it("副作用成功但落定失败时仍回 200，且不得标记 failed", async () => {
    CURRENT_EVENT = event("evt_finalize_fail", "customer.discount.created", { id: "di_1" });
    finalizeMock.mockRejectedValueOnce(new Error("finalize down"));

    const response = await post();
    // 副作用已完成：回 500 或写 failed 都会让 Stripe 重试时重放副作用
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(finalizeMock).toHaveBeenCalledTimes(1);
    expect(finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: "evt_finalize_fail", status: "skipped" }),
    );
  });
});
