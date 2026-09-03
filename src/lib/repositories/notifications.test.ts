/**
 * notifications repository 单测（B06）
 * mock server client，验证列表/批量标已读/单条标已读与错误抛错
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

import {
  listRecentNotifications,
  markAllNotificationsRead,
  markNotificationRead,
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
