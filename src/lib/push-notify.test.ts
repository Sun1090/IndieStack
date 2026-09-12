/**
 * 即时 Web Push 投递单测（v0.8.0）
 * 覆盖：偏好门控、provider 未配置、扇出成功、持久化入队与回执、
 * 瞬时失败退避重试、404/410 撤销订阅并落死信、持久化失败降级
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverPushNotification, type PushDeliveryDependencies } from "./push-notify";
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

function deps(overrides: PushDeliveryDependencies = {}): PushDeliveryDependencies {
  return {
    createProvider: () => provider(),
    listSubscriptions: async () => [subscription],
    enqueueAttempts: vi.fn().mockResolvedValue(undefined),
    markSent: vi.fn().mockResolvedValue(undefined),
    markRetry: vi.fn().mockResolvedValue(undefined),
    markDead: vi.fn().mockResolvedValue(undefined),
    recordMetricFn: vi.fn().mockReturnValue(true),
    now: () => new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
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
      deps({
        createProvider: () => p,
        listSubscriptions: async () => [subscription, { ...subscription, id: "s2", endpoint: "e2" }],
      }),
    );
    expect(result).toEqual({ attempted: 2, sent: 2, failed: 0, revoked: 0, dead: 0, skipped: false });
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
    const enqueueAttempts = vi.fn();
    await expect(deliverPushNotification(
      { userId: "u1", type: "system", title: "t", notificationId: "n1" },
      {},
      deps({ createProvider: () => provider(false), enqueueAttempts }),
    )).rejects.toThrow("not configured");
    // 未配置时不入队，避免把整条队列刷成死信
    expect(enqueueAttempts).not.toHaveBeenCalled();
  });

  it("enqueues per-endpoint attempts before sending and records sent receipts", async () => {
    const p = provider();
    const d = deps({
      createProvider: () => p,
      listSubscriptions: async () => [subscription, { ...subscription, id: "s2", endpoint: "e2" }],
    });
    await deliverPushNotification(
      { userId: "u1", type: "system", title: "t", notificationId: "n1" },
      {},
      d,
    );
    expect(d.enqueueAttempts).toHaveBeenCalledWith("n1", "u1", [
      { subscriptionId: "s1", endpoint: subscription.endpoint },
      { subscriptionId: "s2", endpoint: "e2" },
    ], new Date("2026-01-01T00:00:00Z"));
    expect(d.markSent).toHaveBeenCalledWith("n1", subscription.endpoint, 1, new Date("2026-01-01T00:00:00Z"));
    expect(d.markSent).toHaveBeenCalledTimes(2);
    expect(d.markRetry).not.toHaveBeenCalled();
  });

  it("stores transient failures as pending retries with exponential backoff", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    const d = deps({
      createProvider: () => ({ name: "web-push", configured: true, send }),
      reportError: vi.fn().mockResolvedValue(undefined),
    });
    const result = await deliverPushNotification(
      { userId: "u1", type: "system", title: "t", notificationId: "n1" },
      {},
      d,
    );
    expect(result).toEqual({ attempted: 1, sent: 0, failed: 1, revoked: 0, dead: 0, skipped: false });
    expect(d.markRetry).toHaveBeenCalledWith(
      "n1",
      subscription.endpoint,
      {
        attemptCount: 1,
        nextAttemptAt: new Date("2026-01-01T00:01:00Z"),
        failureCode: "http-500",
        error: "boom",
      },
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(d.markDead).not.toHaveBeenCalled();
    expect(d.reportError).toHaveBeenCalledWith("[Push Notify] 投递失败（留待重试）", expect.any(Error));
  });

  it("revokes permanently gone endpoints, dead-letters them and emits a metric", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    const remove = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      createProvider: () => ({ name: "web-push", configured: true, send }),
      removeSubscription: remove,
      reportError: vi.fn().mockResolvedValue(undefined),
    });
    const result = await deliverPushNotification(
      { userId: "u1", type: "system", title: "t", notificationId: "n1" },
      {},
      d,
    );
    expect(result).toEqual({ attempted: 1, sent: 0, failed: 0, revoked: 1, dead: 1, skipped: false });
    expect(remove).toHaveBeenCalledWith("u1", subscription.endpoint);
    expect(d.markDead).toHaveBeenCalledWith(
      "n1",
      subscription.endpoint,
      { attemptCount: 1, failureCode: "subscription-gone", error: "gone" },
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(d.recordMetricFn).toHaveBeenCalledWith("push.endpoint.revoked", 1, {
      unit: "count",
      attributes: { reason: "subscription-gone", channel: "push" },
    });
    expect(d.markRetry).not.toHaveBeenCalled();
  });

  it("reports endpoint cleanup failures but still dead-letters the attempt", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 404 }));
    const d = deps({
      createProvider: () => ({ name: "web-push", configured: true, send }),
      removeSubscription: vi.fn().mockRejectedValue(new Error("db down")),
      reportError: vi.fn().mockResolvedValue(undefined),
    });
    const result = await deliverPushNotification(
      { userId: "u1", type: "system", title: "t", notificationId: "n1" },
      {},
      d,
    );
    expect(result).toMatchObject({ revoked: 1, dead: 1, failed: 0 });
    expect(d.reportError).toHaveBeenCalledWith("[Push Notify] 失效订阅清理失败", expect.any(Error));
    expect(d.markDead).toHaveBeenCalled();
  });

  it("keeps transient failures on the next endpoint after one fails", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    const d = deps({
      createProvider: () => ({ name: "web-push", configured: true, send }),
      listSubscriptions: async () => [subscription, { ...subscription, id: "s2", endpoint: "e2" }],
      reportError: vi.fn().mockResolvedValue(undefined),
    });
    const result = await deliverPushNotification(
      { userId: "u1", type: "system", title: "t", notificationId: "n1" },
      {},
      d,
    );
    expect(result).toEqual({ attempted: 2, sent: 1, failed: 1, revoked: 0, dead: 0, skipped: false });
    expect(d.markRetry).toHaveBeenCalledTimes(1);
    expect(d.markSent).toHaveBeenCalledTimes(1);
  });

  it("degrades to best-effort delivery when the queue write fails", async () => {
    const markRetry = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockRejectedValue(new Error("network"));
    const d = deps({
      createProvider: () => ({ name: "web-push", configured: true, send }),
      enqueueAttempts: vi.fn().mockRejectedValue(new Error("db down")),
      markRetry,
      reportError: vi.fn().mockResolvedValue(undefined),
    });
    const result = await deliverPushNotification(
      { userId: "u1", type: "system", title: "t", notificationId: "n1" },
      {},
      d,
    );
    expect(result).toMatchObject({ attempted: 1, failed: 1, sent: 0 });
    expect(d.reportError).toHaveBeenCalledWith("[Push Notify] 投递队列写入失败", expect.any(Error));
    // 队列写入失败后不再尝试回执，避免二次噪音
    expect(markRetry).not.toHaveBeenCalled();
  });

  it("stays best-effort without a notification id", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network"));
    const d = deps({
      createProvider: () => ({ name: "web-push", configured: true, send }),
      reportError: vi.fn().mockResolvedValue(undefined),
    });
    const result = await deliverPushNotification(
      { userId: "u1", type: "system", title: "t" },
      {},
      d,
    );
    expect(result).toMatchObject({ attempted: 1, failed: 1 });
    expect(d.enqueueAttempts).not.toHaveBeenCalled();
    expect(d.markRetry).not.toHaveBeenCalled();
  });

  it("reports receipt write failures without failing the send", async () => {
    const d = deps({ markSent: vi.fn().mockRejectedValue(new Error("db down")), reportError: vi.fn().mockResolvedValue(undefined) });
    const result = await deliverPushNotification(
      { userId: "u1", type: "system", title: "t", notificationId: "n1" },
      {},
      d,
    );
    expect(result).toMatchObject({ sent: 1 });
    expect(d.reportError).toHaveBeenCalledWith("[Push Notify] 投递回执写入失败", expect.any(Error));
  });
});
