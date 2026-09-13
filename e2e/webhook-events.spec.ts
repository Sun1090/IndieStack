/** Stripe webhook route E2E (v0.6.0 F05). */
import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import Stripe from "stripe";

const APP_URL = "http://localhost:3100";
const TOKEN = "e2e-bearer-token";
const SECRET = "whsec_e2e_webhook";

function signedEvent(
  eventId: string,
  eventType = "customer.created",
  dataObject: Record<string, unknown> = { id: "cus_e2e" },
) {
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    api_version: "2025-03-31.basil",
    created: Math.floor(Date.now() / 1000),
    data: { object: dataObject },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: eventType,
  });
  return { payload, signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) };
}

test.describe("Stripe webhook events (F05)", () => {
  let api: APIRequestContext;
  test.beforeAll(async ({ playwright }) => {
    api = await pwRequest.newContext({ baseURL: APP_URL });
  });
  test.afterAll(async () => api.dispose());
  test.beforeEach(async () => {
    await api.delete("/api/e2e/webhook-events", { headers: { authorization: `Bearer ${TOKEN}` } });
  });

  test("拒绝缺失与无效签名", async () => {
    const missing = await api.post("/api/webhooks/stripe", { data: "{}" });
    expect(missing.status()).toBe(400);
    const invalid = await api.post("/api/webhooks/stripe", {
      data: "{}",
      headers: { "stripe-signature": "t=1,v1=invalid" },
    });
    expect(invalid.status()).toBe(400);
  });

  /** 投递签名事件；返回响应供断言 */
  async function deliver(
    eventId: string,
    eventType = "customer.created",
    dataObject?: Record<string, unknown>,
  ) {
    const event = signedEvent(eventId, eventType, dataObject);
    return api.post("/api/webhooks/stripe", {
      data: event.payload,
      headers: { "content-type": "application/json", "stripe-signature": event.signature },
    });
  }

  /** 读取 webhook_events 中某个 event_id 的记录 */
  async function storedEvents(eventId: string) {
    const res = await api.get(`/api/e2e/webhook-events?event_id=${eventId}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()) as {
      total: number;
      events: { status: string; event_type: string; attempts: number | null }[];
    };
  }

  test("合法事件落库为 skipped，重复 event id 只记一行", async () => {
    const first = await deliver("evt_e2e_idempotent");
    expect(first.status()).toBe(200);
    await expect(first.json()).resolves.toEqual({ received: true });

    const second = await deliver("evt_e2e_idempotent");
    expect(second.status()).toBe(200);
    // 重复投递由 claim_webhook_event 判定为 duplicate，不再执行副作用
    await expect(second.json()).resolves.toEqual({ received: true, duplicate: true });

    const json = await storedEvents("evt_e2e_idempotent");
    expect(json.total).toBe(1);
    expect(json.events[0]).toMatchObject({
      status: "skipped",
      event_type: "customer.created",
      attempts: 1,
    });
  });

  test("重复投递不重放副作用（付款通知只写一次）", async () => {
    await api.delete("/api/e2e/seed-notifications", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    // includeSent：付款通知属实时单发类型，本地捕获端点回执后 email_sent 会被置 true，
    // 默认的“待发队列”过滤会把它排除，这里显式放开以断言副作用总数。
    const countNotifications = async () => {
      const res = await api.get("/api/e2e/seed-notifications?includeSent=true", {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.ok()).toBeTruthy();
      return ((await res.json()) as { total: number }).total;
    };
    expect(await countNotifications()).toBe(0);

    const invoice = {
      id: "in_e2e_no_replay",
      parent: { subscription_details: { subscription: "sub_e2e_no_replay" } },
    };
    const first = await deliver("evt_e2e_no_replay", "invoice.payment_succeeded", invoice);
    expect(first.status()).toBe(200);
    expect(((await first.json()) as { received: boolean }).received).toBe(true);
    expect(await countNotifications()).toBe(1);

    // 第二次投递同一 event id：Stripe 重试语义，必须跳过副作用
    const second = await deliver("evt_e2e_no_replay", "invoice.payment_succeeded", invoice);
    expect(second.status()).toBe(200);
    await expect(second.json()).resolves.toEqual({ received: true, duplicate: true });
    expect(await countNotifications()).toBe(1);

    const json = await storedEvents("evt_e2e_no_replay");
    expect(json.events[0]).toMatchObject({ status: "skipped", attempts: 1 });
  });

  test("invoice.payment_succeeded 走 skipped 分支并记录事件类型", async () => {
    const res = await deliver("evt_e2e_invoice", "invoice.payment_succeeded", {
      id: "in_e2e",
      parent: { subscription_details: { subscription: "sub_e2e" } },
    });
    expect(res.status()).toBe(200);
    const json = await storedEvents("evt_e2e_invoice");
    expect(json.total).toBe(1);
    expect(json.events[0]).toMatchObject({
      status: "skipped",
      event_type: "invoice.payment_succeeded",
    });
  });

  test("E2E 查询端点需要 Bearer 且 mock 关闭时不存在", async () => {
    const unauthorized = await api.get("/api/e2e/webhook-events");
    expect(unauthorized.status()).toBe(401);
  });
});
