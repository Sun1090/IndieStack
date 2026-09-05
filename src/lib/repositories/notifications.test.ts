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
  countUnreadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  createNotification,
  listUnsentEmailNotifications,
  markEmailSent,
  markEmailFailed,
  EMAIL_MAX_ATTEMPTS,
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

  it("查询失败抛错（页面展示错误态）", async () => {
    createClientMock.mockResolvedValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(listRecentNotifications("u1")).rejects.toThrow("db");
  });
});

describe("countUnreadNotifications()", () => {
  it("返回未读数", async () => {
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({ count: 5 })));
    await expect(countUnreadNotifications("u1")).resolves.toBe(5);
  });

  it("空计数回退 0", async () => {
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({})));
    await expect(countUnreadNotifications("u1")).resolves.toBe(0);
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

  it("死信过滤：重试计数达到上限的不再进入队列", async () => {
    const chain = chainMock({ data: [] });
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await listUnsentEmailNotifications();
    expect(chain.or).toHaveBeenCalledWith(
      `metadata->>email_attempts.is.null,metadata->>email_attempts.lt.${EMAIL_MAX_ATTEMPTS}`,
    );
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(listUnsentEmailNotifications()).rejects.toThrow("db");
  });
});

describe("markEmailFailed()", () => {
  it("写入重试计数与最近错误", async () => {
    const chain = chainMock({});
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    const metadata = { email_attempts: 2, email_error: "resend 500: boom" };
    await expect(markEmailFailed("n1", metadata)).resolves.toBeUndefined();
    expect(chain.update).toHaveBeenCalledWith({ metadata });
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(markEmailFailed("n1", { email_attempts: 1 })).rejects.toThrow("db");
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
