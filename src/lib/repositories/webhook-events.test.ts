/**
 * webhook-events repository 单测（B08 / H06）
 * mock admin client，验证幂等占位、结果落定与列表查询
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import {
  claimWebhookEvent,
  finalizeWebhookEvent,
  listRecentWebhookEvents,
  countWebhookEvents,
} from "./webhook-events";

const ROW = { provider: "stripe", event_id: "evt_1", event_type: "charge.succeeded" };

/** { rpc() } 客户端 mock：记录入参并返回设定结果 */
function rpcClientMock(result: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn(() => Promise.resolve({ data: null, error: null, ...result }));
  return { rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("claimWebhookEvent()", () => {
  it("首次投递返回 claimed 并透传 RPC 参数", async () => {
    const client = rpcClientMock({ data: [{ outcome: "claimed", attempts: 1 }] });
    createAdminClientMock.mockReturnValue(client);
    await expect(claimWebhookEvent(ROW)).resolves.toEqual({ outcome: "claimed", attempts: 1 });
    expect(client.rpc).toHaveBeenCalledWith("claim_webhook_event", {
      p_provider: "stripe",
      p_event_id: "evt_1",
      p_event_type: "charge.succeeded",
    });
  });

  it("重复投递返回 duplicate 与累计 attempts", async () => {
    createAdminClientMock.mockReturnValue(
      rpcClientMock({ data: [{ outcome: "duplicate", attempts: 3 }] }),
    );
    await expect(claimWebhookEvent(ROW)).resolves.toEqual({ outcome: "duplicate", attempts: 3 });
  });

  it("RPC 也接受对象形态的单行结果", async () => {
    createAdminClientMock.mockReturnValue(
      rpcClientMock({ data: { outcome: "claimed", attempts: 2 } }),
    );
    await expect(claimWebhookEvent(ROW)).resolves.toEqual({ outcome: "claimed", attempts: 2 });
  });

  it("attempts 缺失时回落 0", async () => {
    createAdminClientMock.mockReturnValue(rpcClientMock({ data: [{ outcome: "duplicate" }] }));
    await expect(claimWebhookEvent(ROW)).resolves.toEqual({ outcome: "duplicate", attempts: 0 });
  });

  it("数据库错误抛错（不得降级为 duplicate）", async () => {
    createAdminClientMock.mockReturnValue(rpcClientMock({ error: { message: "db" } }));
    await expect(claimWebhookEvent(ROW)).rejects.toThrow("db");
  });

  it("空结果与未知 outcome 都抛错（fail-closed）", async () => {
    createAdminClientMock.mockReturnValue(rpcClientMock({ data: [] }));
    await expect(claimWebhookEvent(ROW)).rejects.toThrow("意外的结果");

    createAdminClientMock.mockReturnValue(rpcClientMock({ data: [{ outcome: "weird" }] }));
    await expect(claimWebhookEvent(ROW)).rejects.toThrow("意外的结果");
  });
});

describe("finalizeWebhookEvent()", () => {
  it("按 (provider, event_id) 更新状态并清空错误信息", async () => {
    const chain = chainMock({});
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await expect(
      finalizeWebhookEvent({ provider: "stripe", event_id: "evt_1", status: "processed" }),
    ).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith("webhook_events");
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "processed", error_message: null }),
    );
    expect(chain.eq).toHaveBeenCalledWith("provider", "stripe");
    expect(chain.eq).toHaveBeenCalledWith("event_id", "evt_1");
  });

  it("失败状态透传错误信息", async () => {
    const chain = chainMock({});
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await finalizeWebhookEvent({
      provider: "stripe",
      event_id: "evt_1",
      status: "failed",
      error_message: "boom",
    });
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error_message: "boom" }));
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(
      finalizeWebhookEvent({ provider: "stripe", event_id: "evt_1", status: "skipped" }),
    ).rejects.toThrow("db");
  });
});

describe("listRecentWebhookEvents()", () => {
  it("成功返回列表并透传 limit", async () => {
    const rows = [{ ...ROW, id: "1" }];
    const chain = chainMock({ data: rows });
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await expect(listRecentWebhookEvents(10)).resolves.toEqual(rows);
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(listRecentWebhookEvents()).rejects.toThrow("db");
  });
});

describe("countWebhookEvents()", () => {
  it("成功返回 count", async () => {
    const chain = chainMock({ count: 7 });
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await expect(countWebhookEvents()).resolves.toBe(7);
    expect(chain.select).toHaveBeenCalledWith("*", { count: "exact", head: true });
  });

  it("count 为 null 时回落 0", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ count: null })));
    await expect(countWebhookEvents()).resolves.toBe(0);
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(countWebhookEvents()).rejects.toThrow("db");
  });
});

describe("listRecentWebhookEvents() 空数据分支", () => {
  it("data 为 null 时回落空数组", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ data: null })));
    await expect(listRecentWebhookEvents()).resolves.toEqual([]);
  });
});
