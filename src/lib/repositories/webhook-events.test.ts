/**
 * webhook-events repository 单测（B08）
 * mock admin client，验证幂等写入（含 payload 兜底）与列表查询
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { upsertWebhookEvent, listRecentWebhookEvents, countWebhookEvents } from "./webhook-events";

const ROW = { provider: "stripe", event_id: "evt_1", event_type: "charge.succeeded", status: "ok" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertWebhookEvent()", () => {
  it("成功写入不抛错", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({})));
    await expect(upsertWebhookEvent(ROW)).resolves.toBeUndefined();
  });

  it("缺 payload 时兜底空对象", async () => {
    const chain = chainMock({});
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await upsertWebhookEvent(ROW);
    expect(chain.upsert).toHaveBeenCalledWith({ ...ROW, payload: {} }, { onConflict: "event_id" });
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(upsertWebhookEvent(ROW)).rejects.toThrow("db");
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
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ count: null })),
    );
    await expect(countWebhookEvents()).resolves.toBe(0);
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(countWebhookEvents()).rejects.toThrow("db");
  });
});

describe("upsertWebhookEvent() payload 分支", () => {
  it("payload 已提供时原样透传", async () => {
    const chain = chainMock({});
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    const payload = { email_attempts: 2 };
    await upsertWebhookEvent({ ...ROW, payload });
    expect(chain.upsert).toHaveBeenCalledWith(
      { ...ROW, payload },
      { onConflict: "event_id" },
    );
  });
});

describe("listRecentWebhookEvents() 空数据分支", () => {
  it("data 为 null 时回落空数组", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ data: null })),
    );
    await expect(listRecentWebhookEvents()).resolves.toEqual([]);
  });
});
