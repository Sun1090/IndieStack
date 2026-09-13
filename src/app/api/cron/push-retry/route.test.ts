/**
 * /api/cron/push-retry 路由测试（v0.8.0）
 * 覆盖：鉴权、空队列、成功计数、保留策略清理、执行失败 500、GET/POST 等价
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metricEvents } from "@/lib/testing/metric-events";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const {
  runPushRetryMock,
  countPendingMock,
  listDueMock,
  listNotificationsMock,
  getSubscriptionMock,
  getNotificationSettingsMock,
  markSentMock,
  markRetryMock,
  markDeadMock,
  pruneMock,
  removeSubscriptionMock,
  createPushProviderMock,
  logApiErrorMock,
} = vi.hoisted(() => ({
  runPushRetryMock: vi.fn(),
  countPendingMock: vi.fn(async () => 0),
  listDueMock: vi.fn(async () => []),
  listNotificationsMock: vi.fn(async () => []),
  getSubscriptionMock: vi.fn(async () => null),
  getNotificationSettingsMock: vi.fn(async () => new Map()),
  markSentMock: vi.fn(async () => {}),
  markRetryMock: vi.fn(async () => {}),
  markDeadMock: vi.fn(async () => {}),
  pruneMock: vi.fn(async () => ({ sent: 0, dead: 0 })),
  removeSubscriptionMock: vi.fn(async () => {}),
  createPushProviderMock: vi.fn(() => ({ name: "web-push", configured: true, send: vi.fn() })),
  logApiErrorMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/push-retry", () => ({
  runPushRetry: runPushRetryMock,
  PUSH_RETRY_BATCH_SIZE: 50,
}));

vi.mock("@/lib/repositories/push-delivery-attempts", () => ({
  PUSH_BACKLOG_ALERT_THRESHOLD: 500,
  PUSH_SENT_RETENTION_DAYS: 7,
  PUSH_DEAD_RETENTION_DAYS: 30,
  countPendingPushDeliveries: countPendingMock,
  listDuePushDeliveryAttempts: listDueMock,
  markPushDeliverySent: markSentMock,
  markPushDeliveryRetry: markRetryMock,
  markPushDeliveryDead: markDeadMock,
  prunePushDeliveryAttempts: pruneMock,
}));

vi.mock("@/lib/repositories/push-subscriptions", () => ({
  getPushSubscriptionById: getSubscriptionMock,
  removePushSubscription: removeSubscriptionMock,
}));

vi.mock("@/lib/repositories/notifications", () => ({
  listNotificationsByIds: listNotificationsMock,
}));

vi.mock("@/lib/repositories/profiles", () => ({
  listNotificationSettingsByIds: getNotificationSettingsMock,
}));

vi.mock("@/lib/push-provider", () => ({
  createPushProvider: createPushProviderMock,
}));

vi.mock("@/lib/api-log", () => ({ logApiError: logApiErrorMock }));

function req(secret = "***") {
  return new NextRequest("http://localhost/api/cron/push-retry", {
    headers: { "x-cron-secret": secret },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "***";
});

afterEach(() => vi.restoreAllMocks());

/** 解析 console.log 里的结构化指标行（非指标输出会被忽略）。 */

describe("/api/cron/push-retry", () => {
  it("缺少或错误 secret 返回 401，并上报可区分的拒绝指标（E03）", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await GET(new NextRequest("http://localhost/api/cron/push-retry"))).status).toBe(401);
    expect((await POST(req("wrong"))).status).toBe(401);
    expect(runPushRetryMock).not.toHaveBeenCalled();
    expect(pruneMock).not.toHaveBeenCalled();

    expect(metricEvents(log)).toEqual([
      expect.objectContaining({
        name: "cron.auth.rejected",
        value: 1,
        attributes: { worker: "push-retry", reason: "missing_credentials" },
      }),
      expect.objectContaining({
        name: "cron.auth.rejected",
        value: 1,
        attributes: { worker: "push-retry", reason: "invalid_credentials" },
      }),
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("wrong");
  });

  it("CRON_SECRET 未配置时归因到部署漏配（而非调用方错误）", async () => {
    delete process.env.CRON_SECRET;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(
      (
        await GET(
          new NextRequest("http://localhost/api/cron/push-retry", {
            headers: { authorization: "Bearer whatever" },
          }),
        )
      ).status,
    ).toBe(401);
    expect(metricEvents(log)).toEqual([
      expect.objectContaining({
        name: "cron.auth.rejected",
        attributes: { worker: "push-retry", reason: "secret_unconfigured" },
      }),
    ]);
  });

  it("接受 Bearer CRON_SECRET（Vercel Cron 语义）", async () => {
    runPushRetryMock.mockResolvedValue({ pulled: 0, sent: 0, retried: 0, dead: 0, revoked: 0 });
    const res = await GET(new NextRequest("http://localhost/api/cron/push-retry", {
      headers: { authorization: "Bearer ***" },
    }));
    expect(res.status).toBe(200);
  });

  it("空队列返回全零计数且不回显敏感信息", async () => {
    runPushRetryMock.mockResolvedValue({ pulled: 0, sent: 0, retried: 0, dead: 0, revoked: 0 });
    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      pulled: 0,
      sent: 0,
      retried: 0,
      dead: 0,
      revoked: 0,
      pruned: { sent: 0, dead: 0 },
    });
  });

  it("返回脱敏后的成功/重试/死信计数", async () => {
    runPushRetryMock.mockResolvedValue({ pulled: 4, sent: 2, retried: 1, dead: 1, revoked: 1 });
    const res = await POST(req());
    await expect(res.json()).resolves.toEqual({
      pulled: 4,
      sent: 2,
      retried: 1,
      dead: 1,
      revoked: 1,
      pruned: { sent: 0, dead: 0 },
    });
  });

  it("每轮回报保留策略清理计数", async () => {
    runPushRetryMock.mockResolvedValue({ pulled: 1, sent: 1, retried: 0, dead: 0, revoked: 0 });
    pruneMock.mockResolvedValue({ sent: 12, dead: 3 });
    const res = await POST(req());
    await expect(res.json()).resolves.toEqual({
      pulled: 1,
      sent: 1,
      retried: 0,
      dead: 0,
      revoked: 0,
      pruned: { sent: 12, dead: 3 },
    });
    expect(pruneMock).toHaveBeenCalledTimes(1);
  });

  it("清理失败不影响投递结果，仍返回 200 且 pruned 为 null", async () => {
    runPushRetryMock.mockResolvedValue({ pulled: 1, sent: 1, retried: 0, dead: 0, revoked: 0 });
    pruneMock.mockRejectedValue(new Error("delete timeout"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      pulled: 1,
      sent: 1,
      retried: 0,
      dead: 0,
      revoked: 0,
      pruned: null,
    });
    expect(logApiErrorMock).toHaveBeenCalledWith(
      "[Cron Push Retry] 队列清理失败（不影响投递结果）",
      expect.any(Error),
    );
  });

  it("worker 抛错时返回 500 并上报", async () => {
    runPushRetryMock.mockRejectedValue(new Error("provider not configured"));
    const res = await POST(req());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Internal server error" });
    expect(logApiErrorMock).toHaveBeenCalledWith("[Cron Push Retry] 执行失败", expect.any(Error));
  });
});
