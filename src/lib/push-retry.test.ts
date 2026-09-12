/**
 * push retry worker 单测（v0.8.0）
 * 覆盖：空队列、成功、退避重试、达到上限转死信、订阅缺失、404/410 撤销、
 * 通知缺失、用户关闭 Push、provider 未配置、单端点失败不阻断整轮、回执失败兜底
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPushRetry, type PushRetryDependencies } from "./push-retry";
import { PUSH_BACKOFF_BASE_MS, PUSH_MAX_ATTEMPTS, type PushDeliveryAttempt } from "./repositories/push-delivery-attempts";
import type { Notification } from "./repositories/notifications";
import type { PushProvider } from "./push-provider";
import type { PushSubscriptionRecord } from "./repositories/push-subscriptions";

const NOW = new Date("2026-01-01T00:00:00Z");

function attemptRow(overrides: Partial<PushDeliveryAttempt> = {}): PushDeliveryAttempt {
  return {
    id: "a1",
    notification_id: "n1",
    user_id: "u1",
    push_subscription_id: "s1",
    endpoint: "https://push.example.com/sub",
    status: "pending",
    attempt_count: 0,
    failure_code: null,
    last_error: null,
    next_attempt_at: NOW.toISOString(),
    last_attempt_at: null,
    sent_at: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function notificationRow(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    user_id: "u1",
    idempotency_key: "evt-1",
    type: "security_alert",
    title: "Alert",
    body: "Body",
    link: "/settings",
    metadata: null,
    is_read: false,
    email_sent: false,
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

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

function deps(overrides: Partial<PushRetryDependencies> = {}): PushRetryDependencies {
  return {
    createProvider: () => provider(),
    listDue: async () => [attemptRow()],
    listNotifications: async () => [notificationRow()],
    getSubscription: async () => subscription,
    getNotificationSettings: async () => new Map([["u1", { pushNotifications: true }]]),
    markSent: vi.fn().mockResolvedValue(undefined),
    markRetry: vi.fn().mockResolvedValue(undefined),
    markDead: vi.fn().mockResolvedValue(undefined),
    removeSubscription: vi.fn().mockResolvedValue(undefined),
    recordMetric: vi.fn().mockReturnValue(true),
    reportError: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("runPushRetry", () => {
  it("returns zeros without touching the provider when the queue is empty", async () => {
    const createProvider = vi.fn();
    const result = await runPushRetry(deps({ listDue: async () => [], createProvider }));
    expect(result).toEqual({ pulled: 0, sent: 0, retried: 0, dead: 0, revoked: 0 });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("sends due attempts and records the incremented attempt count", async () => {
    const p = provider();
    const d = deps({ createProvider: () => p, listDue: async () => [attemptRow({ attempt_count: 1 })] });
    const result = await runPushRetry(d);
    expect(result).toEqual({ pulled: 1, sent: 1, retried: 0, dead: 0, revoked: 0 });
    expect(p.send).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      p256dh: "p",
      auth: "a",
      title: "Alert",
      body: "Body",
      link: "/settings",
      tag: "evt-1",
    });
    expect(d.markSent).toHaveBeenCalledWith("n1", subscription.endpoint, 2, NOW);
  });

  it("schedules a backoff retry for transient failures below the limit", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 503 }));
    const d = deps({ createProvider: () => ({ name: "web-push", configured: true, send }) });
    const result = await runPushRetry(d);
    expect(result).toEqual({ pulled: 1, sent: 0, retried: 1, dead: 0, revoked: 0 });
    expect(d.markRetry).toHaveBeenCalledWith(
      "n1",
      subscription.endpoint,
      {
        attemptCount: 1,
        nextAttemptAt: new Date(NOW.getTime() + PUSH_BACKOFF_BASE_MS),
        failureCode: "http-503",
        error: "boom",
      },
      NOW,
    );
    expect(d.markDead).not.toHaveBeenCalled();
  });

  it("dead-letters after reaching the attempt limit", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network"));
    const d = deps({
      createProvider: () => ({ name: "web-push", configured: true, send }),
      listDue: async () => [attemptRow({ attempt_count: PUSH_MAX_ATTEMPTS - 1 })],
    });
    const result = await runPushRetry(d);
    expect(result).toEqual({ pulled: 1, sent: 0, retried: 0, dead: 1, revoked: 0 });
    expect(d.markDead).toHaveBeenCalledWith(
      "n1",
      subscription.endpoint,
      { attemptCount: PUSH_MAX_ATTEMPTS, failureCode: "max-attempts", error: "network" },
      NOW,
    );
    expect(d.markRetry).not.toHaveBeenCalled();
    expect(d.recordMetric).toHaveBeenCalledWith("push.delivery.dead", 1, {
      unit: "count",
      attributes: { reason: "max-attempts", channel: "push" },
    });
  });

  it("revokes the local subscription when the push service reports 410", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    const d = deps({ createProvider: () => ({ name: "web-push", configured: true, send }) });
    const result = await runPushRetry(d);
    expect(result).toEqual({ pulled: 1, sent: 0, retried: 0, dead: 1, revoked: 1 });
    expect(d.removeSubscription).toHaveBeenCalledWith("u1", subscription.endpoint);
    expect(d.markDead).toHaveBeenCalledWith(
      "n1",
      subscription.endpoint,
      { attemptCount: 1, failureCode: "subscription-gone", error: "gone" },
      NOW,
    );
    expect(d.recordMetric).toHaveBeenCalledWith("push.endpoint.revoked", 1, {
      unit: "count",
      attributes: { reason: "subscription-gone", channel: "push" },
    });
  });

  it("dead-letters without sending when the subscription row is gone", async () => {
    const p = provider();
    const d = deps({ createProvider: () => p, getSubscription: async () => null });
    const result = await runPushRetry(d);
    expect(result).toEqual({ pulled: 1, sent: 0, retried: 0, dead: 1, revoked: 1 });
    expect(p.send).not.toHaveBeenCalled();
    expect(d.markDead).toHaveBeenCalledWith(
      "n1",
      subscription.endpoint,
      { attemptCount: 1, failureCode: "subscription-missing", error: "push subscription no longer exists" },
      NOW,
    );
  });

  it("dead-letters when the notification row is missing", async () => {
    const p = provider();
    const d = deps({ createProvider: () => p, listNotifications: async () => [] });
    const result = await runPushRetry(d);
    expect(result).toEqual({ pulled: 1, sent: 0, retried: 0, dead: 1, revoked: 0 });
    expect(p.send).not.toHaveBeenCalled();
    expect(d.markDead).toHaveBeenCalledWith(
      "n1",
      subscription.endpoint,
      { attemptCount: 1, failureCode: "notification-missing", error: "notification row missing" },
      NOW,
    );
  });

  it("drops retries for users who disabled push instead of retrying forever", async () => {
    const p = provider();
    const d = deps({
      createProvider: () => p,
      getNotificationSettings: async () => new Map([["u1", { pushNotifications: false }]]),
    });
    const result = await runPushRetry(d);
    expect(result).toEqual({ pulled: 1, sent: 0, retried: 0, dead: 1, revoked: 0 });
    expect(p.send).not.toHaveBeenCalled();
    expect(d.markDead).toHaveBeenCalledWith(
      "n1",
      subscription.endpoint,
      { attemptCount: 1, failureCode: "push-disabled", error: "user disabled push notifications" },
      NOW,
    );
  });

  it("fails loudly when the provider is not configured", async () => {
    await expect(runPushRetry(deps({ createProvider: () => provider(false) }))).rejects.toThrow("not configured");
  });

  it("keeps processing the batch after a single endpoint fails", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const d = deps({
      createProvider: () => ({ name: "web-push", configured: true, send }),
      listDue: async () => [
        attemptRow(),
        attemptRow({ id: "a2", notification_id: "n2", push_subscription_id: "s2", endpoint: "e2" }),
      ],
      listNotifications: async () => [notificationRow(), notificationRow({ id: "n2" })],
      getSubscription: async (id) => ({ ...subscription, id, endpoint: id === "s2" ? "e2" : subscription.endpoint }),
    });
    const result = await runPushRetry(d);
    expect(result).toEqual({ pulled: 2, sent: 1, retried: 1, dead: 0, revoked: 0 });
  });

  it("reports receipt failures without losing the send result", async () => {
    const d = deps({
      markSent: vi.fn().mockRejectedValue(new Error("db down")),
      markDead: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await expect(runPushRetry(d)).resolves.toMatchObject({ sent: 1 });
    expect(d.reportError).toHaveBeenCalledWith("[Push Retry] 成功回执写入失败", expect.any(Error));
  });

  it("honours an explicit batch size when pulling due rows", async () => {
    const listDue = vi.fn().mockResolvedValue([]);
    await runPushRetry(deps({ listDue, batchSize: 5 }));
    expect(listDue).toHaveBeenCalledWith(5, NOW);
  });
});
