import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverPushNotification } from "./push-notify";
import type { PushProvider } from "./push-provider";
import type { PushSubscriptionRecord } from "./repositories/push-subscriptions";

const subscription: PushSubscriptionRecord = {
  id: "s1",
  user_id: "u1",
  endpoint: "https://push.example.com/sub",
  p256dh: "p",
  auth: "a",
  user_agent: null,
};

function provider(configured = true): PushProvider {
  return { name: "web-push", configured, send: vi.fn().mockResolvedValue(undefined) };
}

beforeEach(() => vi.clearAllMocks());

describe("deliverPushNotification", () => {
  it("skips when the user preference disables push", async () => {
    const list = vi.fn();
    const result = await deliverPushNotification(
      { userId: "u1", type: "system", title: "t" },
      { pushNotifications: false },
      { listSubscriptions: list },
    );
    expect(result).toMatchObject({ skipped: true, attempted: 0 });
    expect(list).not.toHaveBeenCalled();
  });

  it("delivers to every active browser subscription", async () => {
    const p = provider();
    const result = await deliverPushNotification(
      { userId: "u1", type: "security_alert", title: "Alert", body: "Body", link: "/settings", idempotencyKey: "evt-1" },
      {},
      {
        createProvider: () => p,
        listSubscriptions: async () => [subscription, { ...subscription, id: "s2", endpoint: "e2" }],
      },
    );
    expect(result).toEqual({ attempted: 2, sent: 2, failed: 0, revoked: 0, skipped: false });
    expect(p.send).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: subscription.endpoint,
      p256dh: "p",
      auth: "a",
      title: "Alert",
      body: "Body",
      link: "/settings",
      tag: "evt-1",
    }));
  });

  it("skips delivery when no browser subscription exists", async () => {
    const result = await deliverPushNotification(
      { userId: "u1", type: "system", title: "t" },
      {},
      { createProvider: provider, listSubscriptions: async () => [] },
    );
    expect(result).toMatchObject({ skipped: true, attempted: 0 });
  });

  it("does not attempt delivery when VAPID is not configured", async () => {
    await expect(deliverPushNotification(
      { userId: "u1", type: "system", title: "t" },
      {},
      { createProvider: () => provider(false), listSubscriptions: async () => [subscription] },
    )).rejects.toThrow("not configured");
  });

  it("revokes permanently gone endpoints without counting them as failures", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    const remove = vi.fn().mockResolvedValue(undefined);
    const result = await deliverPushNotification(
      { userId: "u1", type: "system", title: "t" },
      {},
      {
        createProvider: () => ({ name: "web-push", configured: true, send }),
        listSubscriptions: async () => [subscription],
        removeSubscription: remove,
      },
    );
    expect(result).toEqual({ attempted: 1, sent: 0, failed: 0, revoked: 1, skipped: false });
    expect(remove).toHaveBeenCalledWith("u1", subscription.endpoint);
  });

  it("logs transient failures and continues to the next endpoint", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    const reportError = vi.fn().mockResolvedValue(undefined);
    const result = await deliverPushNotification(
      { userId: "u1", type: "system", title: "t" },
      {},
      {
        createProvider: () => ({ name: "web-push", configured: true, send }),
        listSubscriptions: async () => [subscription, { ...subscription, id: "s2", endpoint: "e2" }],
        reportError,
      },
    );
    expect(result).toEqual({ attempted: 2, sent: 1, failed: 1, revoked: 0, skipped: false });
    expect(reportError).toHaveBeenCalledWith("[Push Notify] 投递失败", expect.any(Error));
  });

  it("reports cleanup failures explicitly", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 404 }));
    const reportError = vi.fn().mockResolvedValue(undefined);
    const result = await deliverPushNotification(
      { userId: "u1", type: "system", title: "t" },
      {},
      {
        createProvider: () => ({ name: "web-push", configured: true, send }),
        listSubscriptions: async () => [subscription],
        removeSubscription: vi.fn().mockRejectedValue(new Error("db down")),
        reportError,
      },
    );
    expect(result).toMatchObject({ failed: 1, revoked: 0 });
    expect(reportError).toHaveBeenCalledWith("[Push Notify] 失效订阅清理失败", expect.any(Error));
  });
});
