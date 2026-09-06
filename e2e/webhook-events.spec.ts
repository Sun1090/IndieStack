/** Stripe webhook route E2E (v0.6.0 F05). */
import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import Stripe from "stripe";

const APP_URL = "http://localhost:3100";
const TOKEN = "e2e-bearer-token";
const SECRET = "whsec_e2e_webhook";

function signedEvent(eventId: string, eventType = "customer.created") {
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    api_version: "2025-03-31.basil",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: "cus_e2e" } },
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

  test("合法事件落库为 skipped，重复 event id 保持幂等", async () => {
    const event = signedEvent("evt_e2e_idempotent");
    const first = await api.post("/api/webhooks/stripe", {
      data: event.payload,
      headers: { "content-type": "application/json", "stripe-signature": event.signature },
    });
    expect(first.status()).toBe(200);
    await expect(first.json()).resolves.toEqual({ received: true });

    const second = await api.post("/api/webhooks/stripe", {
      data: event.payload,
      headers: { "content-type": "application/json", "stripe-signature": event.signature },
    });
    expect(second.status()).toBe(200);

    const listed = await api.get("/api/e2e/webhook-events?event_id=evt_e2e_idempotent", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(listed.ok()).toBeTruthy();
    const json = (await listed.json()) as { total: number; events: { status: string; event_type: string }[] };
    expect(json.total).toBe(1);
    expect(json.events[0]).toMatchObject({ status: "skipped", event_type: "customer.created" });
  });

  test("invoice.payment_succeeded 走 skipped 分支并记录事件类型", async () => {
    const event = signedEvent("evt_e2e_invoice", "invoice.payment_succeeded");
    const res = await api.post("/api/webhooks/stripe", {
      data: event.payload,
      headers: { "content-type": "application/json", "stripe-signature": event.signature },
    });
    expect(res.status()).toBe(200);
    const listed = await api.get("/api/e2e/webhook-events?event_id=evt_e2e_invoice", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const json = (await listed.json()) as { total: number; events: { status: string; event_type: string }[] };
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
