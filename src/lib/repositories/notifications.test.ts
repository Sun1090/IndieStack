/**
 * notifications repository 单测（B06）
 * mock server client，验证列表/批量标已读/单条标已读与错误抛错
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createClientMock, createAdminClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import {
  listRecentNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  createNotification,
  listUnsentEmailNotifications,
  markEmailSent,
  NOTIFICATION_TYPES,
} from "./notifications";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listRecentNotifications()", () => {
  it("成功返回通知列表", async () => {
    const rows = [{ id: "n1" }, { id: "n2" }];
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({ data: rows })));
    await expect(listRecentNotifications("u1", 10)).resolves.toEqual(rows);
  });

  it("空数据回退空数组", async () => {
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({})));
    await expect(listRecentNotifications("u1")).resolves.toEqual([]);
  });
});

describe("markAllNotificationsRead()", () => {
  it("返回更新行数", async () => {
    createClientMock.mockResolvedValue(
      dbClientMock(() => chainMock({ data: [{ id: "n1" }, { id: "n2" }] })),
    );
    await expect(markAllNotificationsRead("u1")).resolves.toBe(2);
  });

  it("无更新行返回 0", async () => {
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({})));
    await expect(markAllNotificationsRead("u1")).resolves.toBe(0);
  });
});

describe("NOTIFICATION_TYPES", () => {
  it("包含 seed 既有与新增类型", () => {
    for (const t of ["system", "team_invite", "role_changed", "payment_succeeded", "billing_update", "deployment", "security_alert"]) {
      expect(NOTIFICATION_TYPES).toContain(t);
    }
  });
});

describe("createNotification()", () => {
  it("成功写入并透传字段", async () => {
    const chain = chainMock({});
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await expect(
      createNotification({ userId: "u1", type: "team_invite", title: "hi", link: "/team" }),
    ).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith("notifications");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", type: "team_invite", title: "hi", link: "/team" }),
    );
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(
      createNotification({ userId: "u1", type: "system", title: "hi" }),
    ).rejects.toThrow("db");
  });
});

describe("listUnsentEmailNotifications()", () => {
  it("按未发送+未读+类型拉取并透传 limit", async () => {
    const rows = [{ id: "n1", type: "team_invite" }];
    const chain = chainMock({ data: rows });
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await expect(listUnsentEmailNotifications(["team_invite"], 10)).resolves.toEqual(rows);
    expect(from).toHaveBeenCalledWith("notifications");
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(listUnsentEmailNotifications()).rejects.toThrow("db");
  });
});

describe("markEmailSent()", () => {
  it("成功标记不抛错", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({})));
    await expect(markEmailSent("n1")).resolves.toBeUndefined();
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(markEmailSent("n1")).rejects.toThrow("db");
  });
});

describe("markNotificationRead()", () => {
  it("成功不抛错", async () => {
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({})));
    await expect(markNotificationRead("u1", "n1")).resolves.toBeUndefined();
  });

  it("数据库错误抛错", async () => {
    createClientMock.mockResolvedValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(markNotificationRead("u1", "n1")).rejects.toThrow("db");
  });
});
