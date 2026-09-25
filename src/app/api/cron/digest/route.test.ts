/**
 * /api/cron/digest 路由测试
 * 覆盖：鉴权（含 E03 拒绝指标）、空队列、发送与回执、发送失败兜底、条件跳过的计数可见（A04）、整轮失败落表
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { metricEvents } from "@/lib/testing/metric-events";
import { NextRequest } from "next/server";
import { POST } from "./route";

const { listUnsentEmailNotificationsMock, countUnsentEmailNotificationsMock, markEmailSentMock, markEmailFailedMock, markEmailSkippedMock, recordWorkerRunMock, logApiErrorMock, createAdminClientMock, renderEmailHtmlMock } = vi.hoisted(() => ({
  listUnsentEmailNotificationsMock: vi.fn(),
  countUnsentEmailNotificationsMock: vi.fn(async () => 0),
  markEmailSentMock: vi.fn(async () => {}),
  markEmailFailedMock: vi.fn(async () => {}),
  markEmailSkippedMock: vi.fn(async () => {}),
  recordWorkerRunMock: vi.fn(async () => {}),
  logApiErrorMock: vi.fn(async () => {}),
  createAdminClientMock: vi.fn(),
  renderEmailHtmlMock: vi.fn(),
}));

// 默认**照原样渲染**（有一条用例要断言真实正文），只是留一个能让它第 N 次抛错的把手：
// 「崩在发送中途」这一类必须可测，而循环里剩下的未保护代码就是模板渲染。
vi.mock("@/lib/email-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email-template")>();
  renderEmailHtmlMock.mockImplementation(actual.renderEmailHtml);
  return { ...actual, renderEmailHtml: renderEmailHtmlMock };
});

vi.mock("@/lib/repositories/notifications", () => ({
  listUnsentEmailNotifications: listUnsentEmailNotificationsMock,
  countUnsentEmailNotifications: countUnsentEmailNotificationsMock,
  markEmailSent: markEmailSentMock,
  markEmailFailed: markEmailFailedMock,
  markEmailSkipped: markEmailSkippedMock,
  EMAIL_BACKLOG_ALERT_THRESHOLD: 500,
  NOTIFICATION_TYPES: [] as string[],
}));

vi.mock("@/lib/repositories/worker-runs", () => ({
  recordWorkerRun: recordWorkerRunMock,
}));

vi.mock("@/lib/api-log", () => ({
  logApiError: logApiErrorMock,
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
  // 固定时钟：轮次耗时断言需要确定值（发送不再看向导时刻）
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-01-01T00:00:00Z").getTime());
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 解析 console.log 里的结构化指标行（非指标输出会被忽略）。 */

describe("POST /api/cron/digest", () => {
  it("缺少正确 secret 返回 401，并上报拒绝指标（E03）", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(new NextRequest("http://localhost/api/cron/digest"));
    expect(res.status).toBe(401);
    expect(metricEvents(log)).toEqual([
      expect.objectContaining({
        name: "cron.auth.rejected",
        value: 1,
        attributes: { worker: "digest", reason: "missing_credentials" },
      }),
    ]);
  });

  it("空队列返回 sent=0，并记录完整轮次耗时（E04）", async () => {
    listUnsentEmailNotificationsMock.mockResolvedValue([]);
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    vi.mocked(Date.now).mockReturnValueOnce(base).mockReturnValueOnce(base + 125);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 0, groups: 0, failed: 0 });
    expect(recordWorkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ pulled: 0, durationMs: 125 }),
    );
    expect(metricEvents(log)).toContainEqual(
      expect.objectContaining({
        name: "cron.digest.completed",
        value: 125,
        unit: "ms",
        attributes: { pulled: 0, sent: 0, groups: 0, failed: 0 },
      }),
    );
  });

  it("每轮都上报 email.backlog，恰好阈值不触发异常告警（E04）", async () => {
    countUnsentEmailNotificationsMock.mockResolvedValue(500);
    listUnsentEmailNotificationsMock.mockResolvedValue([]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(metricEvents(log)).toContainEqual(
      expect.objectContaining({ name: "email.backlog", value: 500, unit: "count", attributes: {} }),
    );
    expect(logApiErrorMock).not.toHaveBeenCalled();
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

  it("任意时区的用户在一次调度里都会收到摘要（错峰门控已移除）", async () => {
    // 回归钉子：曾经的 isDigestHour 要求「本地小时恰好等于 8」，而 Hobby plan 每天只有一个
    // 固定 UTC 时刻，结果是除 UTC-1 时区带外没人能收到。这三个时区在该时刻分属早/午/夜，
    // 门控一旦回来，这里只会发出 0-1 封。
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-22T09:00:00Z").getTime());
    const notif = (id: string, user: string) => ({
      id,
      user_id: user,
      type: "system",
      title: `t-${id}`,
      body: null,
      created_at: "2026-09-22",
      is_read: false,
      email_sent: false,
      link: null,
      metadata: null,
    });
    listUnsentEmailNotificationsMock.mockResolvedValue([
      notif("n1", "u1"),
      notif("n2", "u2"),
      notif("n3", "u3"),
    ]);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() =>
        chainMock({
          data: [
            { id: "u1", email: "sh@b.c", timezone: "Asia/Shanghai", notification_settings: { emailNotifications: true } },
            { id: "u2", email: "ny@b.c", timezone: "America/New_York", notification_settings: { emailNotifications: true } },
            { id: "u3", email: "sp@b.c", timezone: "America/Sao_Paulo", notification_settings: { emailNotifications: true } },
          ],
        }),
      ),
    });

    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 3, groups: 3, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(markEmailSentMock).toHaveBeenCalledTimes(3);
  });

  it("资料没有邮箱时跳过，并把条数上报成 cron.digest.skipped{reason=no_email}", async () => {
    listUnsentEmailNotificationsMock.mockResolvedValue([
      { id: "n1", user_id: "u1", type: "system", title: "A", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
      { id: "n2", user_id: "u1", type: "system", title: "B", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
    ]);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => chainMock({ data: [{ id: "u1", email: null, notification_settings: null }] })),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(req());
    await expect(res.json()).resolves.toEqual({ sent: 0, groups: 0, failed: 0 });
    expect(metricEvents(log)).toContainEqual(
      expect.objectContaining({
        name: "cron.digest.skipped",
        value: 2,
        unit: "count",
        attributes: { reason: "no_email" },
      }),
    );
    // 没有可投递目标：不发、不标已发、也不累加重试（那不是故障），但**必须当场出队**，
    // 否则这些行永远占住 created_at 升序 + limit 100 的队首（A05 要修的正是这个）。
    expect(fetchMock).not.toHaveBeenCalled();
    expect(markEmailSentMock).not.toHaveBeenCalled();
    expect(markEmailFailedMock).not.toHaveBeenCalled();
    expect(markEmailSkippedMock).toHaveBeenCalledTimes(1);
    expect(markEmailSkippedMock).toHaveBeenCalledWith(["n1", "n2"], "no_email");
  });

  it("用户关掉所有相关类型时跳过，并上报 reason=preference", async () => {
    listUnsentEmailNotificationsMock.mockResolvedValue([
      { id: "n1", user_id: "u1", type: "system", title: "A", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
    ]);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() =>
        chainMock({ data: [{ id: "u1", email: "a@b.c", notification_settings: { emailNotifications: false } }] }),
      ),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(req());
    await expect(res.json()).resolves.toEqual({ sent: 0, groups: 0, failed: 0 });
    expect(metricEvents(log)).toContainEqual(
      expect.objectContaining({
        name: "cron.digest.skipped",
        value: 1,
        unit: "count",
        attributes: { reason: "preference" },
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(markEmailSentMock).not.toHaveBeenCalled();
    // 偏好全关是用户的选择：出队原因是 preferences_off，不是失败重试
    expect(markEmailSkippedMock).toHaveBeenCalledTimes(1);
    expect(markEmailSkippedMock).toHaveBeenCalledWith(["n1"], "preferences_off");
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

  it("队列积压超阈值时告警（C03）", async () => {
    countUnsentEmailNotificationsMock.mockResolvedValue(501);
    listUnsentEmailNotificationsMock.mockResolvedValue([]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(metricEvents(log)).toContainEqual(
      expect.objectContaining({ name: "email.backlog", value: 501, unit: "count", attributes: {} }),
    );
    expect(logApiErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("队列积压 501"),
      expect.objectContaining({ message: "email_backlog_threshold_exceeded" }),
    );
  });

  it("整轮失败时上报 failed 指标并落一条带 error 的运行记录（E03）", async () => {
    listUnsentEmailNotificationsMock.mockRejectedValue(new Error("supabase down"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(req());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Internal server error" });
    expect(metricEvents(log)).toContainEqual(
      expect.objectContaining({
        name: "cron.digest.failed",
        value: 1,
        attributes: { error_type: "Error" },
      }),
    );
    expect(metricEvents(log).map((event) => event.name)).not.toContain("cron.digest.completed");
    expect(recordWorkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: "supabase down", durationMs: expect.any(Number) }),
    );
    expect(logApiErrorMock).toHaveBeenCalledWith(
      "[Cron Digest] 执行失败",
      expect.objectContaining({ message: "supabase down" }),
    );
  });

  it("失败轮次的运行记录写入失败时不让原始错误被吞掉（E03）", async () => {
    listUnsentEmailNotificationsMock.mockRejectedValue(new Error("supabase down"));
    recordWorkerRunMock.mockRejectedValueOnce(new Error("insert denied"));
    vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(logApiErrorMock).toHaveBeenCalledWith(
      "[Cron Digest] 失败轮次写入运行记录失败",
      expect.objectContaining({ message: "insert denied" }),
    );
    expect(logApiErrorMock).toHaveBeenCalledWith(
      "[Cron Digest] 执行失败",
      expect.objectContaining({ message: "supabase down" }),
    );
  });

  it("拉到条目后整轮抛错：失败轮次记的是真实 pulled，不是 0", async () => {
    // A05 的「空发送轮次」只数 pulled>0 && sent===0 && failed===0。失败落表若写死 pulled:0，
    // 「拉到 100 条然后整轮崩掉」这一类——队列头部正压着东西的那一类——就永远不进那个数字。
    listUnsentEmailNotificationsMock.mockResolvedValue([
      { id: "n1", user_id: "u1", type: "security_alert", title: "A", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
      { id: "n2", user_id: "u2", type: "security_alert", title: "B", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
    ]);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => chainMock({ data: null, error: { message: "profiles down" } })),
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(recordWorkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pulled: 2,
        sent: 0,
        groups: 0,
        failed: 0,
        error: "profiles down",
      }),
    );
  });

  it("崩在发送中途的那一轮：运行记录带上已经寄出的那一组，而不是全 0", async () => {
    // 落表写死 sent:0 的代价不是「少记一个数」：A05 的空发送轮次只数
    // pulled>0 && sent===0 && failed===0，于是**真的寄出去了信**的那一轮会被报成空转。
    listUnsentEmailNotificationsMock.mockResolvedValue([
      { id: "n1", user_id: "u1", type: "system", title: "A", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
      { id: "n2", user_id: "u2", type: "system", title: "B", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
    ]);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => chainMock({ data: [
        { id: "u1", email: "a@b.c", notification_settings: { emailNotifications: true } },
        { id: "u2", email: "c@d.e", notification_settings: { emailNotifications: true } },
      ] })),
    });
    // 第一组正常渲染并寄出，第二组在渲染时抛错——任何中途的意外异常都是这个形状。
    renderEmailHtmlMock
      .mockImplementationOnce(() => "<html>first</html>")
      .mockImplementationOnce(() => {
        throw new Error("template boom");
      });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(recordWorkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pulled: 2,
        sent: 1,
        groups: 1,
        failed: 0,
        error: "template boom",
      }),
    );
    expect(metricEvents(log)).toContainEqual(
      expect.objectContaining({ name: "cron.digest.failed", value: 1 }),
    );
  });

  it("发送回执写失败不再中断整轮，也不把已经寄出的信记成没寄", async () => {
    listUnsentEmailNotificationsMock.mockResolvedValue([
      { id: "n1", user_id: "u1", type: "system", title: "A", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
      { id: "n2", user_id: "u1", type: "system", title: "B", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
    ]);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => chainMock({ data: [{ id: "u1", email: "a@b.c", notification_settings: { emailNotifications: true } }] })),
    });
    markEmailSentMock.mockRejectedValueOnce(new Error("rls denied"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(req());
    expect(res.status).toBe(200);
    // provider 已经收下这封信，所以 sent 记 2：回执写不写得动不改变「寄出去了」这件事。
    await expect(res.json()).resolves.toEqual({ sent: 2, groups: 1, failed: 0 });
    expect(markEmailSentMock).toHaveBeenCalledTimes(2);
    expect(logApiErrorMock).toHaveBeenCalledWith(
      "[Cron Digest] 邮件已发出，但发送回执写入失败（下一轮摘要可能重复寄出）",
      expect.objectContaining({ message: "rls denied" }),
    );
    expect(logApiErrorMock).not.toHaveBeenCalledWith(
      "[Cron Digest] 执行失败",
      expect.anything(),
    );
    expect(metricEvents(log)).toContainEqual(
      expect.objectContaining({
        name: "cron.digest.receipt_failed",
        value: 1,
        attributes: { stage: "sent" },
      }),
    );
    expect(recordWorkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ sent: 2, groups: 1, failed: 0 }),
    );
  });

  it("失败回执也写不进去时：failed 照记，但说清是重试次数没累加", async () => {
    listUnsentEmailNotificationsMock.mockResolvedValue([
      { id: "n1", user_id: "u1", type: "system", title: "A", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
    ]);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => chainMock({ data: [{ id: "u1", email: "a@b.c", notification_settings: { emailNotifications: true } }] })),
    });
    fetchMockResolved.ok = false;
    fetchMockResolved.text = async () => "boom";
    markEmailFailedMock.mockRejectedValue(new Error("update denied"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 0, groups: 0, failed: 1 });
    expect(logApiErrorMock).toHaveBeenCalledWith(
      "[Cron Digest] 失败回执写入失败（该行重试次数未累加，下一轮仍会重发）",
      expect.objectContaining({ message: "update denied" }),
    );
    // 两句「回执」文案各自只属于一条路径
    expect(logApiErrorMock).not.toHaveBeenCalledWith(
      "[Cron Digest] 邮件已发出，但发送回执写入失败（下一轮摘要可能重复寄出）",
      expect.anything(),
    );
    expect(metricEvents(log)).toContainEqual(
      expect.objectContaining({
        name: "cron.digest.receipt_failed",
        value: 1,
        attributes: { stage: "retry" },
      }),
    );
  });

  it("抛的不是 Error 也不是带 message 的对象：落表退回 String()，不写空字符串", async () => {
    listUnsentEmailNotificationsMock.mockRejectedValue("resend unreachable");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(recordWorkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ pulled: 0, error: "resend unreachable" }),
    );
  });

  it("执行后落一行运行记录（C02）", async () => {
    listUnsentEmailNotificationsMock.mockResolvedValue([
      { id: "n1", user_id: "u1", type: "system", title: "A", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
    ]);
    countUnsentEmailNotificationsMock.mockResolvedValue(1);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => chainMock({ data: [{ id: "u1", email: "a@b.c", notification_settings: { emailNotifications: true } }] })),
    });

    await POST(req());
    expect(recordWorkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ pulled: 1, sent: 1, groups: 1, failed: 0, durationMs: expect.any(Number) }),
    );
  });

  it("跳过原因写不进去时报 receipt_failed{stage=skip}，且不把整轮抛穿成「空发送轮次」", async () => {
    listUnsentEmailNotificationsMock.mockResolvedValue([
      { id: "n1", user_id: "u1", type: "security_alert", title: "A", body: null, created_at: "2026-01-01", is_read: false, email_sent: false, link: null, metadata: null },
    ]);
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => chainMock({ data: [{ id: "u1", email: null, notification_settings: null }] })),
    });
    markEmailSkippedMock.mockRejectedValueOnce(new Error("receipt down"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(req());
    const events = metricEvents(log);
    log.mockRestore();

    // 抛穿会落到 POST 的 catch 里记一轮 pulled>0 / sent=0 / failed=0，正好命中
    // 「空发送轮次」的定义——那才是 A05 面板最不该说出口的话。
    expect(res.status).toBe(200);
    expect(events).toContainEqual(
      expect.objectContaining({
        name: "cron.digest.receipt_failed",
        value: 1,
        attributes: { stage: "skip" },
      }),
    );
    expect(logApiErrorMock).toHaveBeenCalledTimes(1);
    // 整轮走到底：轮次记录里 pulled 说的是拉到了 1 条，而它不是失败轮次
    expect(recordWorkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ pulled: 1, sent: 0, groups: 0, failed: 0, durationMs: expect.any(Number) }),
    );
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "cron.digest.completed" })]),
    );
    expect(events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "cron.digest.failed" })]),
    );
  });
});
