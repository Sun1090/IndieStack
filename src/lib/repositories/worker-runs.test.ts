/**
 * worker-runs repository 单测（v0.5.0 C02，迁移 017）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { recordWorkerRun, listRecentEmailWorkerRuns } from "./worker-runs";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordWorkerRun()", () => {
  it("写入计数、耗时与两笔观测读数", async () => {
    const chain = chainMock({});
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(
      recordWorkerRun({
        pulled: 10,
        sent: 8,
        groups: 3,
        failed: 2,
        durationMs: 1234,
        backlog: 42,
        skipped: 6,
      }),
    ).resolves.toBeUndefined();
    expect(chain.insert).toHaveBeenCalledWith({
      pulled: 10,
      sent: 8,
      groups: 3,
      failed: 2,
      duration_ms: 1234,
      error: null,
      backlog: 42,
      skipped: 6,
    });
  });

  it("**没给读数时写 null 而不是 0**（NULL=本轮未记录到，0=空队列）", async () => {
    // 这条钉子守的是跨天趋势的地基：写侧一旦拿 0 兜底，
    // 「崩在取数前」的那一轮就会在序列里长成「积压已经清零」，
    // 而 `judgeDigestSeries` 唯一无法分辨的错误就是这个。
    const chain = chainMock({});
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await recordWorkerRun({ pulled: 0, sent: 0, groups: 0, failed: 0, durationMs: 1 });
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ backlog: null, skipped: null }),
    );
    expect(chain.insert).not.toHaveBeenCalledWith(expect.objectContaining({ backlog: 0 }));
  });

  it("真实的 0 原样落 0，不被归一成 null", async () => {
    const chain = chainMock({});
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await recordWorkerRun({
      pulled: 0,
      sent: 0,
      groups: 0,
      failed: 0,
      durationMs: 1,
      backlog: 0,
      skipped: 0,
    });
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ backlog: 0, skipped: 0 }));
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ error: { message: "db" } })));
    await expect(
      recordWorkerRun({ pulled: 0, sent: 0, groups: 0, failed: 0, durationMs: 0, error: "boom" }),
    ).rejects.toThrow("db");
  });
});

describe("listRecentEmailWorkerRuns()", () => {
  it("取三列计数 + created_at + 两笔观测读数，从新到旧", async () => {
    // 这条用例的前两版意图都已过时：
    // ① 「只取三列」——`judgeDigestSeries` 判趋势必须有日期；
    // ② 「四列（含 created_at）」——backlog/skipped 现在按轮记在表里（迁移 035），
    //    不取它们就只能拿当前一次读数贯穿全序列，那是一条假趋势。
    const chain = chainMock({
      data: [
        {
          pulled: 4,
          sent: 0,
          failed: 0,
          created_at: "2026-10-06T04:00:00.000Z",
          backlog: 18,
          skipped: 3,
        },
        {
          pulled: 0,
          sent: 0,
          failed: 0,
          created_at: "2026-10-05T04:00:00.000Z",
          backlog: 40,
          skipped: 1,
        },
      ],
    });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(listRecentEmailWorkerRuns(2)).resolves.toEqual([
      { pulled: 4, sent: 0, failed: 0, date: "2026-10-06", backlog: 18, skipped: 3 },
      { pulled: 0, sent: 0, failed: 0, date: "2026-10-05", backlog: 40, skipped: 1 },
    ]);
    expect(chain.select).toHaveBeenCalledWith(
      "pulled, sent, failed, created_at, backlog, skipped",
    );
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(2);
  });

  it("**created_at 缺失时 date 为 undefined，而不是编一个日期出来**", async () => {
    // 编日期比没有日期更坏：`judgeDigestSeries` 会拿它去排序、判重复日期，
    // 一个凭空来的日期会让「积压下降」这句话建立在一个不存在的读数上。
    const chain = chainMock({ data: [{ pulled: 4, sent: 0, failed: 0 }] });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    const rows = await listRecentEmailWorkerRuns();
    expect(rows[0].date).toBeUndefined();
  });

  it("date 只取日期部分，不把时间戳带进来（UTC 日界）", async () => {
    const chain = chainMock({
      data: [{ pulled: 1, sent: 1, failed: 0, created_at: "2026-10-06T23:59:59.999Z" }],
    });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    const rows = await listRecentEmailWorkerRuns();
    expect(rows[0].date).toBe("2026-10-06");
    expect(rows[0].date).toHaveLength(10);
  });

  it("缺列按 0 处理：一行没有 sent 不等于它发出去过未知数量的邮件", async () => {
    const chain = chainMock({ data: [{ pulled: 3 }] });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(listRecentEmailWorkerRuns()).resolves.toEqual([
      { pulled: 3, sent: 0, failed: 0, date: undefined, backlog: undefined, skipped: undefined },
    ]);
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  it("**NULL 读数归一成 undefined，不归成 0**（与计数列的处理刻意不同）", async () => {
    // 崩在取数前的那一轮、以及早于迁移 035 的历史行，backlog/skipped 都是 NULL。
    // 计数列缺列按 0 是对的（那一轮确实没发出去任何东西）；
    // 这两列按 0 就错了：0 在 backlog 上表示「队列已清空」，是一个会参与判定的读数。
    const chain = chainMock({
      data: [
        {
          pulled: 2,
          sent: 0,
          failed: 0,
          created_at: "2026-10-06T04:00:00.000Z",
          backlog: null,
          skipped: null,
        },
      ],
    });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    const rows = await listRecentEmailWorkerRuns();
    expect(rows[0].backlog).toBeUndefined();
    expect(rows[0].skipped).toBeUndefined();
    // 而真实的 0 必须还是 0，不能被同一条归一逻辑吃掉
    const zero = chainMock({
      data: [
        {
          pulled: 0,
          sent: 0,
          failed: 0,
          created_at: "2026-10-06T04:00:00.000Z",
          backlog: 0,
          skipped: 0,
        },
      ],
    });
    createAdminClientMock.mockReturnValue(dbClientMock(() => zero));
    await expect(listRecentEmailWorkerRuns()).resolves.toEqual([
      expect.objectContaining({ backlog: 0, skipped: 0 }),
    ]);
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ error: { message: "db" } })));
    await expect(listRecentEmailWorkerRuns()).rejects.toThrow("db");
  });
});
