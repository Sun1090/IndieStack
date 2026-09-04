/**
 * 通知服务端操作单元测试
 * mock supabase server client、next/cache 与 notifications 仓库，验证标记已读逻辑
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClientMock, revalidatePathMock, markAllNotificationsReadMock, markNotificationReadMock, countUnreadNotificationsMock } =
  vi.hoisted(() => ({
    createClientMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    markAllNotificationsReadMock: vi.fn(),
    markNotificationReadMock: vi.fn(),
    countUnreadNotificationsMock: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

vi.mock("@/lib/repositories/notifications", () => ({
  markAllNotificationsRead: markAllNotificationsReadMock,
  markNotificationRead: markNotificationReadMock,
  countUnreadNotifications: countUnreadNotificationsMock,
}));

import { markAllNotificationsRead, markNotificationRead, getUnreadNotificationCount } from "./notifications";

const USER = { id: "u1", email: "a@b.com" };

function mockClient(opts: { user?: object | null } = {}) {
  const { user = USER } = opts;
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("markAllNotificationsRead()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(markAllNotificationsRead()).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("成功标记已读并触发 revalidatePath", async () => {
    createClientMock.mockResolvedValue(mockClient());
    markAllNotificationsReadMock.mockResolvedValue(3);
    await expect(markAllNotificationsRead()).resolves.toEqual({ ok: true, data: { updated: 3 } });
    expect(markAllNotificationsReadMock).toHaveBeenCalledWith("u1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/notifications");
  });

  it("仓库异常返回 databaseError", async () => {
    createClientMock.mockResolvedValue(mockClient());
    markAllNotificationsReadMock.mockRejectedValue(new Error("boom"));
    await expect(markAllNotificationsRead()).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });
});

describe("getUnreadNotificationCount()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(getUnreadNotificationCount()).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("成功返回未读数", async () => {
    createClientMock.mockResolvedValue(mockClient());
    countUnreadNotificationsMock.mockResolvedValue(3);
    await expect(getUnreadNotificationCount()).resolves.toEqual({ ok: true, data: { unread: 3 } });
    expect(countUnreadNotificationsMock).toHaveBeenCalledWith("u1");
  });

  it("仓库异常返回 databaseError", async () => {
    createClientMock.mockResolvedValue(mockClient());
    countUnreadNotificationsMock.mockRejectedValue(new Error("boom"));
    await expect(getUnreadNotificationCount()).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });
});

describe("markNotificationRead()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(markNotificationRead("n1")).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("成功标记单条已读并触发 revalidatePath", async () => {
    createClientMock.mockResolvedValue(mockClient());
    markNotificationReadMock.mockResolvedValue(undefined);
    await expect(markNotificationRead("n1")).resolves.toEqual({ ok: true });
    expect(markNotificationReadMock).toHaveBeenCalledWith("u1", "n1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/notifications");
  });

  it("仓库异常返回 databaseError", async () => {
    createClientMock.mockResolvedValue(mockClient());
    markNotificationReadMock.mockRejectedValue(new Error("boom"));
    await expect(markNotificationRead("n1")).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });
});