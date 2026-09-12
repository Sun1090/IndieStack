/**
 * push_delivery_attempts repository 单测（v0.8.0，迁移 026）
 * 覆盖：幂等入队、到期队列、成功/重试/死信回执、终态保留清理、死信与失效端点统计、错误抛错
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import {
  INVALID_PUSH_ENDPOINT_CODES,
  PUSH_BACKOFF_BASE_MS,
  PUSH_BACKOFF_CAP_MS,
  PUSH_DEAD_RETENTION_DAYS,
  PUSH_MAX_ATTEMPTS,
  PUSH_PRUNE_BATCH_LIMIT,
  PUSH_SENT_RETENTION_DAYS,
  countDeadLetterPushDeliveries,
  countInvalidPushEndpoints,
  countPendingPushDeliveries,
  enqueuePushDeliveryAttempts,
  listDeadLetterPushDeliveries,
  listDuePushDeliveryAttempts,
  markPushDeliveryDead,
  markPushDeliveryRetry,
  markPushDeliverySent,
  prunePushDeliveryAttempts,
  pushBackoffMs,
} from "./push-delivery-attempts";

beforeEach(() => vi.clearAllMocks());

describe("pushBackoffMs()", () => {
  it("首次失败退避基数，随后指数翻倍", () => {
    expect(pushBackoffMs(1)).toBe(PUSH_BACKOFF_BASE_MS);
    expect(pushBackoffMs(2)).toBe(PUSH_BACKOFF_BASE_MS * 2);
    expect(pushBackoffMs(3)).toBe(PUSH_BACKOFF_BASE_MS * 4);
  });

  it("封顶 1 小时，负数与小数不会产生非法退避", () => {
    expect(pushBackoffMs(20)).toBe(PUSH_BACKOFF_CAP_MS);
    expect(pushBackoffMs(0)).toBe(PUSH_BACKOFF_BASE_MS);
    expect(pushBackoffMs(-5)).toBe(PUSH_BACKOFF_BASE_MS);
    expect(pushBackoffMs(2.9)).toBe(PUSH_BACKOFF_BASE_MS * 2);
  });

  it("退避上限大于基数且重试上限为 3", () => {
    expect(PUSH_BACKOFF_CAP_MS).toBeGreaterThan(PUSH_BACKOFF_BASE_MS);
    expect(PUSH_MAX_ATTEMPTS).toBe(3);
  });
});

describe("enqueuePushDeliveryAttempts()", () => {
  it("按 (notification, endpoint) 幂等入队，忽略重复", async () => {
    const chain = chainMock();
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    const now = new Date("2026-01-01T00:00:00Z");
    await enqueuePushDeliveryAttempts("n1", "u1", [
      { subscriptionId: "s1", endpoint: "https://push/1" },
      { subscriptionId: "s2", endpoint: "https://push/2" },
    ], now);
    expect(chain.upsert).toHaveBeenCalledWith(
      [
        {
          notification_id: "n1",
          user_id: "u1",
          push_subscription_id: "s1",
          endpoint: "https://push/1",
          next_attempt_at: new Date(now.getTime() + PUSH_BACKOFF_BASE_MS).toISOString(),
        },
        {
          notification_id: "n1",
          user_id: "u1",
          push_subscription_id: "s2",
          endpoint: "https://push/2",
          next_attempt_at: new Date(now.getTime() + PUSH_BACKOFF_BASE_MS).toISOString(),
        },
      ],
      { onConflict: "notification_id,endpoint", ignoreDuplicates: true },
    );
  });

  it("空目标直接返回，不访问数据库", async () => {
    await enqueuePushDeliveryAttempts("n1", "u1", []);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("写入失败带上操作上下文抛错", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ error: { message: "db down" } })));
    await expect(
      enqueuePushDeliveryAttempts("n1", "u1", [{ subscriptionId: "s1", endpoint: "e" }]),
    ).rejects.toThrow("push delivery enqueue: db down");
  });
});

describe("listDuePushDeliveryAttempts()", () => {
  it("只拉取 pending 且已到期的行，按到期时间升序", async () => {
    const rows = [{ id: "a1", status: "pending" }];
    const chain = chainMock({ data: rows });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    const now = new Date("2026-01-01T00:00:00Z");
    await expect(listDuePushDeliveryAttempts(25, now)).resolves.toEqual(rows);
    expect(chain.select).toHaveBeenCalledWith("*");
    expect(chain.eq).toHaveBeenCalledWith("status", "pending");
    expect(chain.lte).toHaveBeenCalledWith("next_attempt_at", now.toISOString());
    expect(chain.order).toHaveBeenCalledWith("next_attempt_at", { ascending: true });
    expect(chain.limit).toHaveBeenCalledWith(25);
  });

  it("空数据回退空数组，错误带上下文抛错", async () => {
    createAdminClientMock.mockReturnValueOnce(dbClientMock(() => chainMock({})));
    await expect(listDuePushDeliveryAttempts()).resolves.toEqual([]);
    createAdminClientMock.mockReturnValueOnce(dbClientMock(() => chainMock({ error: { message: "db down" } })));
    await expect(listDuePushDeliveryAttempts()).rejects.toThrow("push delivery due list: db down");
  });
});

describe("回执写入", () => {
  it("markPushDeliverySent 标记 sent、清空失败信息并记录时间", async () => {
    const chain = chainMock();
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    const now = new Date("2026-01-01T00:00:00Z");
    await markPushDeliverySent("n1", "https://push/1", 2, now);
    expect(chain.update).toHaveBeenCalledWith({
      status: "sent",
      attempt_count: 2,
      failure_code: null,
      last_error: null,
      last_attempt_at: now.toISOString(),
      sent_at: now.toISOString(),
    });
    expect(chain.eq).toHaveBeenNthCalledWith(1, "notification_id", "n1");
    expect(chain.eq).toHaveBeenNthCalledWith(2, "endpoint", "https://push/1");
  });

  it("markPushDeliveryRetry 保持 pending 并写入退避时间", async () => {
    const chain = chainMock();
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    const now = new Date("2026-01-01T00:00:00Z");
    await markPushDeliveryRetry("n1", "e", {
      attemptCount: 1,
      nextAttemptAt: new Date(now.getTime() + PUSH_BACKOFF_BASE_MS),
      failureCode: "network",
      error: "boom",
    }, now);
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "pending",
      attempt_count: 1,
      failure_code: "network",
      last_error: "boom",
      last_attempt_at: now.toISOString(),
      next_attempt_at: new Date(now.getTime() + PUSH_BACKOFF_BASE_MS).toISOString(),
    }));
  });

  it("markPushDeliveryDead 记录死信原因", async () => {
    const chain = chainMock();
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await markPushDeliveryDead("n1", "e", { attemptCount: 3, failureCode: "max-attempts" });
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "dead",
      attempt_count: 3,
      failure_code: "max-attempts",
      last_error: null,
    }));
  });

  it("回执写入失败带上下文抛错", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ error: { message: "db down" } })));
    await expect(markPushDeliverySent("n1", "e", 1)).rejects.toThrow("push delivery sent: db down");
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ error: { message: "db down" } })));
    await expect(
      markPushDeliveryRetry("n1", "e", { attemptCount: 1, nextAttemptAt: new Date(), failureCode: "network" }),
    ).rejects.toThrow("push delivery retry: db down");
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ error: { message: "db down" } })));
    await expect(
      markPushDeliveryDead("n1", "e", { attemptCount: 3, failureCode: "max-attempts" }),
    ).rejects.toThrow("push delivery dead: db down");
  });
});

describe("死信与统计查询", () => {
  it("listDeadLetterPushDeliveries 按创建时间升序拉取 dead 行", async () => {
    const rows = [{ id: "d1" }];
    const chain = chainMock({ data: rows });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(listDeadLetterPushDeliveries(10)).resolves.toEqual(rows);
    expect(chain.eq).toHaveBeenCalledWith("status", "dead");
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  it("countPending/countDeadLetter 返回 count，缺失回退 0", async () => {
    createAdminClientMock.mockReturnValueOnce(dbClientMock(() => chainMock({ count: 7 })));
    await expect(countPendingPushDeliveries()).resolves.toBe(7);
    createAdminClientMock.mockReturnValueOnce(dbClientMock(() => chainMock({ count: 2 })));
    await expect(countDeadLetterPushDeliveries()).resolves.toBe(2);
    createAdminClientMock.mockReturnValueOnce(dbClientMock(() => chainMock({})));
    await expect(countPendingPushDeliveries()).resolves.toBe(0);
  });

  it("countInvalidPushEndpoints 只统计失效端点原因", async () => {
    const chain = chainMock({ count: 3 });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(countInvalidPushEndpoints()).resolves.toBe(3);
    expect(chain.eq).toHaveBeenCalledWith("status", "dead");
    expect(chain.in).toHaveBeenCalledWith("failure_code", [...INVALID_PUSH_ENDPOINT_CODES]);
  });

  it("统计查询失败带上下文抛错", async () => {
    createAdminClientMock.mockReturnValueOnce(dbClientMock(() => chainMock({ error: { message: "db down" } })));
    await expect(countPendingPushDeliveries()).rejects.toThrow("push delivery pending count: db down");
    createAdminClientMock.mockReturnValueOnce(dbClientMock(() => chainMock({ error: { message: "db down" } })));
    await expect(countDeadLetterPushDeliveries()).rejects.toThrow("push delivery dead count: db down");
    createAdminClientMock.mockReturnValueOnce(dbClientMock(() => chainMock({ error: { message: "db down" } })));
    await expect(countInvalidPushEndpoints()).rejects.toThrow("push delivery invalid endpoint count: db down");
    createAdminClientMock.mockReturnValueOnce(dbClientMock(() => chainMock({ error: { message: "db down" } })));
    await expect(listDeadLetterPushDeliveries()).rejects.toThrow("push delivery dead list: db down");
  });
});

describe("prunePushDeliveryAttempts()", () => {
  it("按 sent/dead 各自保留期分批清理终态，且不触碰 pending", async () => {
    const chain = chainMock({ data: [{ id: "s1" }] });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    const now = new Date("2026-09-13T12:00:00.000Z");
    const limit = 17;

    await expect(prunePushDeliveryAttempts(now, limit)).resolves.toEqual({ sent: 1, dead: 1 });

    const sentCutoff = new Date(
      now.getTime() - PUSH_SENT_RETENTION_DAYS * 86_400_000,
    ).toISOString();
    const deadCutoff = new Date(
      now.getTime() - PUSH_DEAD_RETENTION_DAYS * 86_400_000,
    ).toISOString();
    expect(chain.eq).toHaveBeenNthCalledWith(1, "status", "sent");
    expect(chain.lt).toHaveBeenNthCalledWith(1, "sent_at", sentCutoff);
    expect(chain.order).toHaveBeenNthCalledWith(1, "sent_at", { ascending: true });
    expect(chain.eq).toHaveBeenNthCalledWith(2, "status", "sent");
    expect(chain.lt).toHaveBeenNthCalledWith(2, "sent_at", sentCutoff);
    expect(chain.eq).toHaveBeenNthCalledWith(3, "status", "dead");
    expect(chain.lt).toHaveBeenNthCalledWith(3, "last_attempt_at", deadCutoff);
    expect(chain.order).toHaveBeenNthCalledWith(2, "last_attempt_at", { ascending: true });
    expect(chain.eq).toHaveBeenNthCalledWith(4, "status", "dead");
    expect(chain.lt).toHaveBeenNthCalledWith(4, "last_attempt_at", deadCutoff);
    expect(chain.limit).toHaveBeenNthCalledWith(1, limit);
    expect(chain.limit).toHaveBeenNthCalledWith(2, limit);
    expect(chain.delete).toHaveBeenCalledTimes(2);
    expect(chain.delete).toHaveBeenCalledWith({ count: "exact" });
    expect(chain.in).toHaveBeenNthCalledWith(1, "id", ["s1"]);
    expect(chain.in).toHaveBeenNthCalledWith(2, "id", ["s1"]);
    expect(chain.eq).not.toHaveBeenCalledWith("status", "pending");
  });

  it("删除回执 count 低于选中数量时以实际删除数为准", async () => {
    const chain = chainMock({ data: [{ id: "s1" }], count: 0 });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(prunePushDeliveryAttempts()).resolves.toEqual({ sent: 0, dead: 0 });
  });

  it("没有过期终态时不执行删除", async () => {
    const chain = chainMock({ data: [] });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(prunePushDeliveryAttempts()).resolves.toEqual({ sent: 0, dead: 0 });
    expect(chain.delete).not.toHaveBeenCalled();
  });

  it("默认批次上限限制单轮清理量", async () => {
    const chain = chainMock({ data: [] });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await prunePushDeliveryAttempts();
    expect(chain.limit).toHaveBeenNthCalledWith(1, PUSH_PRUNE_BATCH_LIMIT);
    expect(chain.limit).toHaveBeenNthCalledWith(2, PUSH_PRUNE_BATCH_LIMIT);
  });

  it("选择失败带状态上下文抛错，不继续后续清理", async () => {
    const chain = chainMock({ error: { message: "db down" } });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(prunePushDeliveryAttempts()).rejects.toThrow(
      "push delivery prune select (sent): db down",
    );
    expect(chain.delete).not.toHaveBeenCalled();
  });

  it("删除失败带状态上下文抛错", async () => {
    let deleteCalled = false;
    const chain: Record<string, unknown> = {};
    const chainMethod = vi.fn(() => chain);
    for (const method of ["select", "eq", "lt", "order", "limit", "in"]) {
      chain[method] = chainMethod;
    }
    chain.delete = vi.fn(() => {
      deleteCalled = true;
      return chain;
    });
    chain.then = (resolve: (value: unknown) => unknown) =>
      resolve(
        deleteCalled
          ? { data: null, error: { message: "delete down" }, count: null }
          : { data: [{ id: "s1" }], error: null, count: null },
      );

    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(prunePushDeliveryAttempts()).rejects.toThrow(
      "push delivery prune delete (sent): delete down",
    );
  });
});
