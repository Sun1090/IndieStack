/**
 * notifications repository 单测（B06）
 * mock server client，验证列表/批量标已读/单条标已读与错误抛错
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
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
  oldestUnsentEmailCreatedAt,
  markEmailSent,
  markEmailFailed,
  listDeadLetterNotifications,
  listNotificationsByIds,
  countUnsentEmailNotifications,
  countEmailSkippedByReason,
  countReadBeforeSendEmailNotifications,
  markEmailSkipped,
  EMAIL_MAX_ATTEMPTS,
  EMAIL_NOTIFICATION_TYPES,
  EMAIL_SKIP_REASONS,
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
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({ error: { message: "db" } })));
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

  it("查询失败抛错，而不是把故障读成「0 条未读」", async () => {
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({ error: { message: "db" } })));
    await expect(countUnreadNotifications("u1")).rejects.toThrow("db");
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

  it("更新失败抛错，而不是报「0 条已读」这种看着像成功的数字", async () => {
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({ error: { message: "db" } })));
    await expect(markAllNotificationsRead("u1")).rejects.toThrow("db");
  });
});

describe("listNotificationsByIds()", () => {
  it("按 id 批量读取通知（push 重试 worker 用）", async () => {
    const rows = [{ id: "n1" }, { id: "n2" }];
    const chain = chainMock({ data: rows });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(listNotificationsByIds(["n1", "n2"])).resolves.toEqual(rows);
    expect(chain.in).toHaveBeenCalledWith("id", ["n1", "n2"]);
  });

  it("空 id 列表不发查询", async () => {
    await expect(listNotificationsByIds([])).resolves.toEqual([]);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("查询失败抛错", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ error: { message: "db" } })));
    await expect(listNotificationsByIds(["n1"])).rejects.toThrow("db");
  });
});

describe("NOTIFICATION_TYPES", () => {
  it("包含 seed 既有与新增类型", () => {
    for (const t of [
      "system",
      "team_invite",
      "role_changed",
      "payment_succeeded",
      "billing_update",
      "deployment",
      "security_alert",
    ]) {
      expect(NOTIFICATION_TYPES).toContain(t);
    }
  });
});

describe("createNotification()", () => {
  it("成功写入并透传字段，返回新建 id", async () => {
    const chain = chainMock({ data: { id: "n9" } });
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await expect(
      createNotification({ userId: "u1", type: "team_invite", title: "hi", link: "/team" }),
    ).resolves.toBe("n9");
    expect(from).toHaveBeenCalledWith("notifications");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", type: "team_invite", title: "hi", link: "/team" }),
    );
    expect(chain.select).toHaveBeenCalledWith("id");
  });

  it("透传幂等键，允许调用方安全重试", async () => {
    const chain = chainMock({ data: { id: "n-idempotent" } });
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => chain) });
    await expect(
      createNotification({
        userId: "u1",
        type: "system",
        title: "retry",
        idempotencyKey: "event-1",
      }),
    ).resolves.toBe("n-idempotent");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ idempotency_key: "event-1" }),
    );
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(createNotification({ userId: "u1", type: "system", title: "hi" })).rejects.toThrow(
      "db",
    );
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

  it("默认队列类型取自 EMAIL_NOTIFICATION_TYPES（E04 口径一致）", async () => {
    const chain = chainMock({ data: [] });
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => chain) });
    await listUnsentEmailNotifications();
    expect(chain.in).toHaveBeenCalledWith("type", [...EMAIL_NOTIFICATION_TYPES]);
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

describe("listDeadLetterNotifications()", () => {
  it("按重试上限查询死信并透传 limit", async () => {
    const chain = chainMock({ data: [{ id: "dead-1" }] });
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => chain) });
    await expect(listDeadLetterNotifications(20)).resolves.toEqual([{ id: "dead-1" }]);
    expect(chain.or).toHaveBeenCalledWith("metadata->>email_attempts.gte.3");
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(listDeadLetterNotifications()).rejects.toThrow("db");
  });
});

describe("countUnsentEmailNotifications()", () => {
  it("返回待发通知总数（同一过滤口径）", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ count: 7 })));
    await expect(countUnsentEmailNotifications()).resolves.toBe(7);
  });

  it("积压计数与拉取共用一个类型来源（E04 口径一致）", async () => {
    const chain = chainMock({ count: 3 });
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => chain) });
    await expect(countUnsentEmailNotifications()).resolves.toBe(3);
    expect(chain.in).toHaveBeenCalledWith("type", [...EMAIL_NOTIFICATION_TYPES]);
    expect(chain.or).toHaveBeenCalledWith(
      `metadata->>email_attempts.is.null,metadata->>email_attempts.lt.${EMAIL_MAX_ATTEMPTS}`,
    );
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(countUnsentEmailNotifications()).rejects.toThrow("db");
  });
});

/** 待发队列的过滤条件走这三个方法；select/order/limit 允许各自不同。 */
function filterCalls(chain: ReturnType<typeof chainMock>) {
  const spied = chain as unknown as Record<string, { mock: { calls: unknown[][] } }>;
  return ["eq", "in", "or"].map((method) => spied[method].mock.calls);
}

describe("oldestUnsentEmailCreatedAt()", () => {
  it("取最老一条：按 created_at 升序只看第一条", async () => {
    const chain = chainMock({ data: [{ created_at: "2026-09-20T00:00:00.000Z" }] });
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => chain) });
    await expect(oldestUnsentEmailCreatedAt()).resolves.toBe("2026-09-20T00:00:00.000Z");
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it("队列为空时没有年龄可报", async () => {
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => chainMock({ data: [] })) });
    await expect(oldestUnsentEmailCreatedAt()).resolves.toBeNull();
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(oldestUnsentEmailCreatedAt()).rejects.toThrow("db");
  });

  it("拉取、计数、最老一条走的是同一段过滤（面板说的必须就是 worker 那支队）", async () => {
    const query = [
      () => listUnsentEmailNotifications(),
      () => countUnsentEmailNotifications(),
      () => oldestUnsentEmailCreatedAt(),
    ];
    const calls: unknown[][] = [];
    for (const runQuery of query) {
      const chain = chainMock({ data: [], count: 0 });
      createAdminClientMock.mockReturnValue({ from: vi.fn(() => chain) });
      await runQuery();
      calls.push(filterCalls(chain));
    }
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toEqual(calls[0]);
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
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({ error: { message: "db" } })));
    await expect(markNotificationRead("u1", "n1")).rejects.toThrow("db");
  });
});

describe("A05 出队：原因列的写入、计数与迁移对账", () => {
  const REPO_ROOT = path.resolve(__dirname, "../../..");

  it("空 id 列表不开第二次 admin 客户端", async () => {
    await markEmailSkipped([], "no_email");
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("按 id 批量写原因：payload 里只有这一列，不带 email_sent", async () => {
    const chain = chainMock({ data: [] });
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => chain) });
    await markEmailSkipped(["n1", "n2"], "preferences_off");
    expect(chain.update).toHaveBeenCalledWith({ email_skipped_reason: "preferences_off" });
    expect(chain.in).toHaveBeenCalledWith("id", ["n1", "n2"]);
  });

  it("写入失败抛错（是调用方决定怎么可见，而不是这里吞掉）", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(markEmailSkipped(["n1"], "no_email")).rejects.toThrow("db");
  });

  it("按登记的原因逐个计数：库里没这种行时补 0，而不是留 undefined", async () => {
    const chains = [chainMock({ count: 4 }), chainMock({})];
    let index = 0;
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => chains[index++]),
    });
    await expect(countEmailSkippedByReason()).resolves.toEqual({
      no_email: 4,
      preferences_off: 0,
    });
    expect(index).toBe(EMAIL_SKIP_REASONS.length);
  });

  it("任一原因计数失败即抛错，不返回半张表", async () => {
    const chains = [chainMock({ count: 1 }), chainMock({ error: { message: "db" } })];
    let index = 0;
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => chains[index++]) });
    await expect(countEmailSkippedByReason()).rejects.toThrow("db");
  });

  it("「站内先读掉」那一笔的口径是 is_read=true + email_sent=false + 队列类型", async () => {
    const chain = chainMock({ count: 9 });
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await expect(countReadBeforeSendEmailNotifications()).resolves.toBe(9);
    expect(from).toHaveBeenCalledWith("notifications");
    expect(chain.eq).toHaveBeenCalledWith("email_sent", false);
    expect(chain.eq).toHaveBeenCalledWith("is_read", true);
    expect(chain.in).toHaveBeenCalledWith("type", [...EMAIL_NOTIFICATION_TYPES]);
  });

  it("读掉那一笔查询失败抛错，不把「看不见」说成「没有」", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(countReadBeforeSendEmailNotifications()).rejects.toThrow("db");
  });

  // 这一条钉的是跨语言层的等式：原因取值集合在 TS 里一份、在库的 CHECK 里一份。
  // 漂移的后果不是「语义变宽」而是写入直接被数据库拒绝，所以必须在 PR 阶段红。
  it("EMAIL_SKIP_REASONS 与 034 迁移的 CHECK 取值完全一致（顺序也算）", () => {
    const sql = fs.readFileSync(
      path.join(REPO_ROOT, "supabase/migrations/034_email_skip_reason.sql"),
      "utf8",
    );
    const match = /email_skipped_reason[\s\S]{0,200}?in\s*\(([^)]*)\)/i.exec(sql);
    if (!match) {
      // 读不到取值就等于这条对账没跑——必须红，不能静默通过
      throw new Error("034 迁移里找不到 email_skipped_reason 的 CHECK 取值列表");
    }
    const values = match[1]
      .split(",")
      .map((part) => part.trim().replace(/^'|'$/g, ""))
      .filter((part) => part.length > 0);
    expect(values).toEqual([...EMAIL_SKIP_REASONS]);
  });
});
