/**
 * marketing 订阅 repository 单测（v0.5.0 A05）
 * 覆盖：pending upsert 复用行、subscribed 短路、token 确认/退订回执、受众列表
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import {
  getSubscriptionByUserId,
  upsertPendingSubscription,
  confirmSubscription,
  unsubscribeByToken,
  deactivateSubscription,
  listSubscribedEmails,
  generateSubscriptionToken,
} from "./marketing";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateSubscriptionToken()", () => {
  it("生成 48 位十六进制且不重复", () => {
    const a = generateSubscriptionToken();
    const b = generateSubscriptionToken();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(a).not.toBe(b);
  });
});

describe("getSubscriptionByUserId()", () => {
  it("返回订阅行或 null", async () => {
    const row = { user_id: "u1", email: "a@b.c", status: "subscribed", token: "t" };
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ data: row })));
    await expect(getSubscriptionByUserId("u1")).resolves.toEqual(row);

    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({})));
    await expect(getSubscriptionByUserId("u1")).resolves.toBeNull();
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ error: { message: "db" } })));
    await expect(getSubscriptionByUserId("u1")).rejects.toThrow("db");
  });
});

describe("upsertPendingSubscription()", () => {
  it("已订阅用户原样返回，不刷新 token", async () => {
    const existing = { user_id: "u1", email: "a@b.c", status: "subscribed", token: "keep" };
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ data: existing })));
    await expect(upsertPendingSubscription("u1", "a@b.c")).resolves.toEqual(existing);
  });

  it("pending/unsubscribed/无记录 → 置 pending 并刷新 token", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ data: { user_id: "u1", email: "a@b.c", status: "pending", token: "new" } })),
    );
    const result = await upsertPendingSubscription("u1", "a@b.c");
    expect(result.status).toBe("pending");
    expect(result.token).toBe("new");
  });
});

describe("confirmSubscription()/unsubscribeByToken()", () => {
  it("token 命中返回 true", async () => {
    const chain = chainMock({ data: [{ id: "m1" }] });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(confirmSubscription("t1")).resolves.toBe(true);
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: "subscribed" }));
  });

  it("token 未命中返回 false", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ data: [] })));
    await expect(unsubscribeByToken("bad")).resolves.toBe(false);
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ error: { message: "db" } })));
    await expect(confirmSubscription("t1")).rejects.toThrow("db");
  });
});

describe("deactivateSubscription()", () => {
  it("按用户置 unsubscribed", async () => {
    const chain = chainMock({});
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(deactivateSubscription("u1")).resolves.toBeUndefined();
    expect(chain.eq).toHaveBeenCalledWith("user_id", "u1");
  });
});

describe("listSubscribedEmails()", () => {
  it("仅返回已订阅受众", async () => {
    const rows = [{ email: "a@b.c", token: "t1" }];
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ data: rows })));
    await expect(listSubscribedEmails()).resolves.toEqual(rows);
  });
});
