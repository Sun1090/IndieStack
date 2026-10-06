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
  it("写入计数与耗时", async () => {
    const chain = chainMock({});
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(
      recordWorkerRun({ pulled: 10, sent: 8, groups: 3, failed: 2, durationMs: 1234 }),
    ).resolves.toBeUndefined();
    expect(chain.insert).toHaveBeenCalledWith({
      pulled: 10,
      sent: 8,
      groups: 3,
      failed: 2,
      duration_ms: 1234,
      error: null,
    });
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ error: { message: "db" } })));
    await expect(
      recordWorkerRun({ pulled: 0, sent: 0, groups: 0, failed: 0, durationMs: 0, error: "boom" }),
    ).rejects.toThrow("db");
  });
});

describe("listRecentEmailWorkerRuns()", () => {
  it("取三列计数 + created_at（跨天趋势判定需要日期），从新到旧", async () => {
    // 这条用例原来叫「只取算空发送轮次用得上的三列」——
    // 那个意图**已经过时**：`judgeDigestSeries` 判「积压是否在降」必须有日期，
    // 而没有日期的轮次只能判单轮。所以第四列是必需的，不是可选的。
    const chain = chainMock({
      data: [
        { pulled: 4, sent: 0, failed: 0, created_at: "2026-10-06T04:00:00.000Z" },
        { pulled: 0, sent: 0, failed: 0, created_at: "2026-10-05T04:00:00.000Z" },
      ],
    });
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(listRecentEmailWorkerRuns(2)).resolves.toEqual([
      { pulled: 4, sent: 0, failed: 0, date: "2026-10-06" },
      { pulled: 0, sent: 0, failed: 0, date: "2026-10-05" },
    ]);
    expect(chain.select).toHaveBeenCalledWith("pulled, sent, failed, created_at");
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
      { pulled: 3, sent: 0, failed: 0, date: undefined },
    ]);
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ error: { message: "db" } })));
    await expect(listRecentEmailWorkerRuns()).rejects.toThrow("db");
  });
});
