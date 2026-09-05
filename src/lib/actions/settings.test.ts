/**
 * 设置服务端操作单元测试
 * mock supabase server client 与 next/cache，验证通知偏好与密码更新逻辑
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ROUTES } from "@/lib/constants";

const { createClientMock, revalidatePathMock, upsertPendingSubscriptionMock, deactivateSubscriptionMock, sendConfirmationMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  upsertPendingSubscriptionMock: vi.fn(),
  deactivateSubscriptionMock: vi.fn(async () => {}),
  sendConfirmationMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/repositories/marketing", () => ({
  upsertPendingSubscription: upsertPendingSubscriptionMock,
  deactivateSubscription: deactivateSubscriptionMock,
}));
vi.mock("@/lib/email-marketing", () => ({
  sendMarketingConfirmationEmail: sendConfirmationMock,
}));

import { updateNotificationSettings, updatePassword } from "./settings";

const USER = { id: "u1", email: "a@b.com" };

function mockClient(
  opts: {
    user?: object | null;
    signInError?: boolean;
    updateUserError?: boolean;
    profileUpdateError?: boolean;
  } = {},
) {
  const {
    user = USER,
    signInError = false,
    updateUserError = false,
    profileUpdateError = false,
  } = opts;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ error: signInError ? { message: "bad" } : null }),
      updateUser: vi.fn().mockResolvedValue({ error: updateUserError ? { message: "db" } : null }),
    },
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() =>
              Promise.resolve(profileUpdateError ? { error: { message: "db" } } : { error: null }),
            ),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertPendingSubscriptionMock.mockResolvedValue({ status: "pending", email: "a@b.com", token: "t1" });
});

describe("updateNotificationSettings()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(updateNotificationSettings(form({}))).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("保存成功并触发 revalidatePath", async () => {
    createClientMock.mockResolvedValue(mockClient());
    const result = await updateNotificationSettings(
      form({ emailNotifications: "on", securityAlerts: "on" }),
    );
    expect(result).toEqual({ ok: true });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardSettings);
  });

  it("数据库错误返回 databaseError", async () => {
    createClientMock.mockResolvedValue(mockClient({ profileUpdateError: true }));
    await expect(updateNotificationSettings(form({}))).resolves.toEqual({ ok: false, error: "databaseError" });
  });

  it("开启营销邮件：创建 pending 订阅并发送确认邮件（A05 double opt-in）", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await updateNotificationSettings(form({ marketingEmails: "on" }));
    expect(upsertPendingSubscriptionMock).toHaveBeenCalledWith("u1", "a@b.com");
    expect(sendConfirmationMock).toHaveBeenCalledWith("a@b.com", "t1");
  });

  it("已确认订阅（subscribed）不重发确认邮件", async () => {
    createClientMock.mockResolvedValue(mockClient());
    upsertPendingSubscriptionMock.mockResolvedValue({ status: "subscribed", email: "a@b.com", token: "t1" });
    await updateNotificationSettings(form({ marketingEmails: "on" }));
    expect(sendConfirmationMock).not.toHaveBeenCalled();
  });

  it("关闭营销邮件：直接退订", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await updateNotificationSettings(form({ marketingEmails: "off" }));
    expect(deactivateSubscriptionMock).toHaveBeenCalledWith("u1");
    expect(upsertPendingSubscriptionMock).not.toHaveBeenCalled();
  });

  it("订阅同步失败不影响保存结果", async () => {
    createClientMock.mockResolvedValue(mockClient());
    upsertPendingSubscriptionMock.mockRejectedValue(new Error("db"));
    await expect(updateNotificationSettings(form({ marketingEmails: "on" }))).resolves.toEqual({ ok: true });
  });
});

describe("updatePassword()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(updatePassword(form({}))).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("缺少当前或新密码返回 passwordsRequired", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(updatePassword(form({ currentPassword: "old123" }))).resolves.toEqual({
      ok: false,
      error: "passwordsRequired",
    });
    await expect(updatePassword(form({ newPassword: "newpass123" }))).resolves.toEqual({
      ok: false,
      error: "passwordsRequired",
    });
  });

  it("新密码过短返回 passwordMin8", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(
      updatePassword(form({ currentPassword: "old123", newPassword: "short" })),
    ).resolves.toEqual({ ok: false, error: "passwordMin8" });
  });

  it("无邮箱账户返回 passwordChangeUnavailable", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: { id: "u1", email: null } }));
    await expect(
      updatePassword(form({ currentPassword: "old123", newPassword: "newpass123" })),
    ).resolves.toEqual({ ok: false, error: "passwordChangeUnavailable" });
  });

  it("当前密码错误返回 currentPasswordIncorrect", async () => {
    createClientMock.mockResolvedValue(mockClient({ signInError: true }));
    await expect(
      updatePassword(form({ currentPassword: "wrong", newPassword: "newpass123" })),
    ).resolves.toEqual({ ok: false, error: "currentPasswordIncorrect" });
  });

  it("更新成功并触发 revalidatePath", async () => {
    createClientMock.mockResolvedValue(mockClient());
    const result = await updatePassword(
      form({ currentPassword: "old123", newPassword: "newpass123" }),
    );
    expect(result).toEqual({ ok: true });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardSettings);
  });

  it("更新用户失败返回 databaseError", async () => {
    createClientMock.mockResolvedValue(mockClient({ updateUserError: true }));
    await expect(
      updatePassword(form({ currentPassword: "old123", newPassword: "newpass123" })),
    ).resolves.toEqual({ ok: false, error: "databaseError" });
  });
});
