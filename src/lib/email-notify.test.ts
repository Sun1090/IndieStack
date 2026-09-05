/**
 * email-notify 实时通知邮件单测（v0.5.0 A03）
 * 覆盖：实时类型即时发送+回执、非实时类型跳过、偏好门控、无邮箱跳过、发送失败吞错留待 cron
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createNotificationMock, markEmailSentMock, createAdminClientMock } = vi.hoisted(() => ({
  createNotificationMock: vi.fn(async () => "n1"),
  markEmailSentMock: vi.fn(async () => {}),
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/repositories/notifications", () => ({
  createNotification: createNotificationMock,
  markEmailSent: markEmailSentMock,
  NOTIFICATION_TYPES: [] as string[],
}));

vi.mock("@/lib/api-log", () => ({
  logApiError: vi.fn(async () => {}),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import { notifyUser, REALTIME_EMAIL_TYPES } from "./email-notify";

function profileChain(row: Record<string, unknown> | null) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "limit"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: row, error: null }));
  createAdminClientMock.mockReturnValue({ from: vi.fn(() => chain) });
}

function notificationInput(type: string) {
  return {
    userId: "u1",
    type: type as Parameters<typeof notifyUser>[0]["type"],
    title: "安全告警",
    body: "异常登录",
    link: "/dashboard",
    metadata: { ip: "1.2.3.4" },
  };
}

const fetchMockResolved: { ok: boolean; text: () => Promise<string> } = { ok: true, text: async () => "" };
let fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => Promise.resolve(fetchMockResolved));

beforeEach(() => {
  vi.clearAllMocks();
  createNotificationMock.mockResolvedValue("n1");
  fetchMockResolved.ok = true;
  vi.stubGlobal("fetch", fetchMock);
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.RESEND_API_KEY = "***";
});

describe("notifyUser()", () => {
  it("实时类型且偏好开启：即时发送并回执 email_sent", async () => {
    profileChain({ id: "u1", email: "a@b.c", notification_settings: { securityAlerts: true } });

    await expect(notifyUser(notificationInput("security_alert"))).resolves.toBeUndefined();
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1];
    expect(String(init?.body)).toContain("安全告警");
    expect(markEmailSentMock).toHaveBeenCalledWith("n1");
  });

  it("非实时类型只写站内通知，不发邮件", async () => {
    await notifyUser(notificationInput("system"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(markEmailSentMock).not.toHaveBeenCalled();
  });

  it("偏好关闭（总开关）跳过邮件", async () => {
    profileChain({ id: "u1", email: "a@b.c", notification_settings: { emailNotifications: false } });
    await notifyUser(notificationInput("team_invite"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("无邮箱用户跳过邮件", async () => {
    profileChain({ id: "u1", email: null, notification_settings: {} });
    await notifyUser(notificationInput("payment_succeeded"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("发送失败吞错不抛出，不回执，留待 cron 重试", async () => {
    profileChain({ id: "u1", email: "a@b.c", notification_settings: {} });
    fetchMockResolved.ok = false;
    fetchMockResolved.text = async () => "boom";

    await expect(notifyUser(notificationInput("security_alert"))).resolves.toBeUndefined();
    expect(markEmailSentMock).not.toHaveBeenCalled();
  });

  it("实时类型集合包含四类高优先级通知", () => {
    for (const t of ["security_alert", "team_invite", "role_changed", "payment_succeeded"]) {
      expect(REALTIME_EMAIL_TYPES.has(t as Parameters<typeof notifyUser>[0]["type"])).toBe(true);
    }
    expect(REALTIME_EMAIL_TYPES.has("system")).toBe(false);
  });
});
