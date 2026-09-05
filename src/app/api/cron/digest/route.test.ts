/**
 * /api/cron/digest 路由测试
 * 覆盖：鉴权、空队列、发送与回执、发送失败兜底
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const { listUnsentEmailNotificationsMock, markEmailSentMock, markEmailFailedMock, createAdminClientMock } = vi.hoisted(() => ({
  listUnsentEmailNotificationsMock: vi.fn(),
  markEmailSentMock: vi.fn(async () => {}),
  markEmailFailedMock: vi.fn(async () => {}),
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/repositories/notifications", () => ({
  listUnsentEmailNotifications: listUnsentEmailNotificationsMock,
  markEmailSent: markEmailSentMock,
  markEmailFailed: markEmailFailedMock,
  NOTIFICATION_TYPES: [] as string[],
}));

vi.mock("@/lib/api-log", () => ({
  logApiError: vi.fn(async () => {}),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

function chainMock(outcome: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "in", "or"]) chain[m] = vi.fn(() => chain);
  Object.assign(chain, { then: (resolve: (v: unknown) => unknown) => resolve(outcome) });
  return chain;
}

function req() {
  return new NextRequest("http://localhost/api/cron/digest", {
    headers: { "x-cron-secret": "***" },
  });
}

const fetchMockResolved: { ok: boolean; text: () => Promise<string> } = { ok: true, text: async () => "" };
let fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => Promise.resolve(fetchMockResolved));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "***";
  process.env.RESEND_API_KEY = "***";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  fetchMockResolved.ok = true;
  fetchMockResolved.text = async () => "";
  vi.stubGlobal("fetch", fetchMock);
  // 固定为默认时区（Asia/Shanghai）本地 08:00，使错峰门控放行
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-01-01T00:00:00Z").getTime());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/cron/digest", () => {
  it("缺少正确 secret 返回 401", async () => {
    const res = await POST(new NextRequest("http://localhost/api/cron/digest"));
    expect(res.status).toBe(401);
  });

  it("空队列返回 sent=0", async () => {
    listUnsentEmailNotificationsMock.mockResolvedValue([]);
    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 0, groups: 0, failed: 0 });
  });

  it("按用户分组发送并标记已发送", async () => {
    listUnsentEmailNotificationsMock.mockResolvedValue([
      { id: "n1", user_id: "u1", type: "system", title: "A", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
      { id: "n2", user_id: "u1", type: "system", title: "B", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
    ]);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => chainMock({ data: [{ id: "u1", email: "a@b.c", notification_settings: { emailNotifications: true } }] })),
    });

    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 2, groups: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.anything());
    expect(markEmailSentMock).toHaveBeenCalledTimes(2);
  });

  it("单用户发送失败计入 failed 并累加重试计数，不阻断整轮", async () => {
    listUnsentEmailNotificationsMock.mockResolvedValue([
      { id: "n1", user_id: "u1", type: "system", title: "A", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: { email_attempts: 1, tag: "x" } },
    ]);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => chainMock({ data: [{ id: "u1", email: "a@b.c", notification_settings: { emailNotifications: true } }] })),
    });
    fetchMockResolved.ok = false;
    fetchMockResolved.text = async () => "boom";

    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sent: 0, groups: 0, failed: 1 });
    expect(JSON.stringify(body)).not.toMatch(/boom/);
    expect(markEmailSentMock).not.toHaveBeenCalled();
    expect(markEmailFailedMock).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ tag: "x", email_attempts: 2, email_error: expect.stringContaining("resend") }),
    );
  });

  it("用户时区未到本地发送小时则跳过（A04 错峰）", async () => {
    // 覆盖默认固定时间：UTC 01:00 = 上海 09:00，不在 08:00 发送窗口
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-01-01T01:00:00Z").getTime());
    listUnsentEmailNotificationsMock.mockResolvedValue([
      { id: "n1", user_id: "u1", type: "system", title: "A", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
    ]);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => chainMock({ data: [{ id: "u1", email: "a@b.c", notification_settings: { emailNotifications: true } }] })),
    });

    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 0, groups: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("用户自带时区按各自本地小时判断（覆盖默认回退窗口）", async () => {
    // 默认固定时间 UTC 00:00 = 上海 08:00（回退用户会发送）；纽约 19:00 → 该用户跳过
    listUnsentEmailNotificationsMock.mockResolvedValue([
      { id: "n1", user_id: "u1", type: "system", title: "A", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
    ]);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => chainMock({ data: [{ id: "u1", email: "a@b.c", timezone: "America/New_York", notification_settings: { emailNotifications: true } }] })),
    });

    const res = await POST(req());
    await expect(res.json()).resolves.toEqual({ sent: 0, groups: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("正文按类型折叠：达到阈值的类型合并计数，明细截断并提示溢出", async () => {
    const deploy = (id: string) => ({ id, user_id: "u1", type: "deployment", title: `deploy ${id}`, body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null });
    listUnsentEmailNotificationsMock.mockResolvedValue([
      ...["d1", "d2", "d3"].map(deploy),
      { id: "s1", user_id: "u1", type: "system", title: "S1", body: "b1", created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
    ]);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => chainMock({ data: [{ id: "u1", email: "a@b.c", notification_settings: { emailNotifications: true } }] })),
    });

    const res = await POST(req());
    expect(res.status).toBe(200);
    const init = fetchMock.mock.calls[0][1];
    expect(String(init?.body)).toContain("部署通知 ×3 条");
    expect(String(init?.body)).toContain("S1");
  });
});
