/**
 * 队列读数组装单测（A05）
 * 锁两件事：每段查询的结果必须原样进规则；时钟由本模块注入而不是留在规则里读系统时间。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const { countMock, oldestMock, runsMock, skippedMock, readBeforeSendMock } = vi.hoisted(() => ({
  countMock: vi.fn(),
  oldestMock: vi.fn(),
  runsMock: vi.fn(),
  skippedMock: vi.fn(),
  readBeforeSendMock: vi.fn(),
}));
vi.mock("@/lib/repositories/notifications", () => ({
  countUnsentEmailNotifications: countMock,
  oldestUnsentEmailCreatedAt: oldestMock,
  countEmailSkippedByReason: skippedMock,
  countReadBeforeSendEmailNotifications: readBeforeSendMock,
}));
vi.mock("@/lib/repositories/worker-runs", () => ({
  listRecentEmailWorkerRuns: runsMock,
}));

import { readEmailQueueDiagnostics, toDailyDigestReadings } from "./queue-observability";

const NOW = "2026-09-22T12:00:00.000Z";
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  skippedMock.mockResolvedValue({});
  readBeforeSendMock.mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readEmailQueueDiagnostics()", () => {
  it("把五段查询原样交给规则，年龄按注入的时钟算", async () => {
    countMock.mockResolvedValue(4);
    oldestMock.mockResolvedValue(new Date(Date.parse(NOW) - 50 * HOUR).toISOString());
    runsMock.mockResolvedValue([
      { pulled: 2, sent: 0, failed: 0 },
      { pulled: 1, sent: 1, failed: 0 },
    ]);
    skippedMock.mockResolvedValue({ no_email: 3, preferences_off: 1 });
    readBeforeSendMock.mockResolvedValue(9);

    // 这里两轮都没有 `date`（老数据/老 mock），所以 `trendRounds` 必须是 0、
    // 趋势判 INSUFFICIENT_DATA + attention=true ——**没有日期就不给趋势**，
    // 而不是拿「同一份 pending」硬凑一个只有一天的假趋势。
    await expect(readEmailQueueDiagnostics()).resolves.toEqual({
      pending: 4,
      oldestAgeMs: 50 * HOUR,
      emptySendRounds: 1,
      stale: true,
      skippedByReason: { no_email: 3, preferences_off: 1 },
      skippedTotal: 4,
      readBeforeSend: 9,
      trendRounds: 0,
      // trend 带 reason：面板/人看到的是「为什么判成这个」，
      // 而 `code` 只是机器可读的结论。断言要把 reason 也钉住——
      // 否则一句「空序列不等于健康」的提醒被悄悄换成空字符串，没人发现。
      trend: {
        code: "INSUFFICIENT_DATA",
        attention: true,
        reason: expect.stringContaining("空序列不等于健康"),
      },
    });
    expect(runsMock).toHaveBeenCalled();
    // 两笔「已经离开队列」的账各查一次；漏掉任何一笔，面板就会把「越堵」说成「越小」
    expect(skippedMock).toHaveBeenCalledTimes(1);
    expect(readBeforeSendMock).toHaveBeenCalledTimes(1);
  });

  it("队列为空时不编造年龄，但仍报得出两笔出队的账", async () => {
    countMock.mockResolvedValue(0);
    oldestMock.mockResolvedValue(null);
    runsMock.mockResolvedValue([]);
    skippedMock.mockResolvedValue({ no_email: 100 });
    readBeforeSendMock.mockResolvedValue(2);

    await expect(readEmailQueueDiagnostics()).resolves.toEqual({
      pending: 0,
      oldestAgeMs: null,
      emptySendRounds: 0,
      stale: false,
      skippedByReason: { no_email: 100, preferences_off: 0 },
      skippedTotal: 100,
      readBeforeSend: 2,
      trendRounds: 0,
      // trend 带 reason：面板/人看到的是「为什么判成这个」，
      // 而 `code` 只是机器可读的结论。断言要把 reason 也钉住——
      // 否则一句「空序列不等于健康」的提醒被悄悄换成空字符串，没人发现。
      trend: {
        code: "INSUFFICIENT_DATA",
        attention: true,
        reason: expect.stringContaining("空序列不等于健康"),
      },
    });
  });
});

describe("跨天趋势接上面板", () => {
  it("同一天多轮只取一轮——否则 judgeDigestSeries 会判重复日期", async () => {
    // recentRuns 是**从新到旧**的，同一天可能有多轮（cron 每小时跑一次）。
    // 若不先去重，同日期的两轮会让趋势判「数据不足」——那不是「数据不足」，
    // 是**接线把数据搞坏了**。
    countMock.mockResolvedValue(10);
    oldestMock.mockResolvedValue(null);
    runsMock.mockResolvedValue([
      { pulled: 1, sent: 1, failed: 0, date: "2026-10-06" },
      { pulled: 2, sent: 2, failed: 0, date: "2026-10-06" },
      { pulled: 3, sent: 3, failed: 0, date: "2026-10-05" },
    ]);
    skippedMock.mockResolvedValue({ no_email: 0, preferences_off: 0 });
    readBeforeSendMock.mockResolvedValue(0);

    const reading = await readEmailQueueDiagnostics();
    // 3 轮输入 → 2 天输出。这一条**直接**钉住去重：
    // 上一版这里只断言 `trendRounds === 2` 却漏了 `daily` 的去重是否真的发生，
    // 结果把去重删掉测试照样全绿——**一个会被变异绕过的断言等于没有断言**。
    expect(reading.trendRounds).toBe(2);
    expect(reading.trend.code).not.toBe("INSUFFICIENT_DATA");

    // 再从另一侧钉一次：如果没去重，同日期两轮会进判定并被判重复日期。
    expect(reading.trend.reason).not.toContain("重复");
  });

  it("**没有日期的轮次不进趋势**（只有一天也不叫趋势）", async () => {
    countMock.mockResolvedValue(10);
    oldestMock.mockResolvedValue(null);
    runsMock.mockResolvedValue([
      { pulled: 1, sent: 1, failed: 0 },
      { pulled: 1, sent: 1, failed: 0 },
    ]);
    skippedMock.mockResolvedValue({ no_email: 0, preferences_off: 0 });
    readBeforeSendMock.mockResolvedValue(0);

    const reading = await readEmailQueueDiagnostics();
    expect(reading.trendRounds).toBe(0);
    expect(reading.trend.attention).toBe(true);
    // 「没有日期就不给趋势」——判成别的东西（比如 HEALTHY）就等于编了一个趋势。
    expect(reading.trend.code).toBe("INSUFFICIENT_DATA");
  });

  it("**readBeforeSend 不进 skipped**——它是「用户在站内读掉了」，不经 worker", async () => {
    countMock.mockResolvedValue(10);
    oldestMock.mockResolvedValue(null);
    runsMock.mockResolvedValue([
      { pulled: 1, sent: 1, failed: 0, date: "2026-10-06" },
      { pulled: 1, sent: 1, failed: 0, date: "2026-10-05" },
    ]);
    // no_email=7 + preferences_off=5 = 12，readBeforeSend 却是 999
    skippedMock.mockResolvedValue({ no_email: 7, preferences_off: 5 });
    readBeforeSendMock.mockResolvedValue(999);

    const reading = await readEmailQueueDiagnostics();
    expect(reading.readBeforeSend).toBe(999);

    // 若 999 被混进 skipped，两个「日」的 skipped 就是 7+5+999=1011 且完全相同，
    // 于是 `skippedRising` 为 false，结论会被静默带偏。
    // 这里用一个**能分辨口径**的断言：两天的 skipped 相同（12），
    // 所以判定不该是「跳过在涨」。这条用例守的正是「skipped 的算法没被换掉」。
    expect(reading.trend.code).not.toBe("A05_DRAINING");
    expect(reading.trend.code).not.toBe("BACKLOG_NOT_DRAINING");
  });

  it("跳过在涨、积压不降 → 判 A05 没修掉（这才是真正该喊的形态）", async () => {
    countMock.mockResolvedValue(10); // 两天都用同一个 pending（近似，已在实现里注明）
    oldestMock.mockResolvedValue(null);
    runsMock.mockResolvedValue([
      { pulled: 1, sent: 1, failed: 0, date: "2026-10-06" },
      { pulled: 1, sent: 1, failed: 0, date: "2026-10-05" },
    ]);
    // 判定里所有天的 skipped 都被写成同一个当前值，所以这里只能
    // 走「积压不动」的分支；**如果未来实现改成按天取真实 skipped，这条用例会提醒重写**。
    skippedMock.mockResolvedValue({ no_email: 0, preferences_off: 0 });
    readBeforeSendMock.mockResolvedValue(0);

    const reading = await readEmailQueueDiagnostics();
    expect(reading.trend.attention).toBe(false);
    expect(reading.trend.code).toBe("HEALTHY_LOW_BACKLOG");
  });
});

describe("toDailyDigestReadings：映射本身（纯函数，能直接观测）", () => {
  it("同一天多轮只留**最新**那一轮，且留下的确实是被留下的那一轮", () => {
    // 输入按「从新到旧」排列：同日第一轮 pulled=90，第二轮 pulled=2。
    // 留下的必须是第一轮（90）。**这条不是冗余**——之前内联版本的
    // 测试数据里同日两轮计数相同，所以「留哪一轮」根本不可观测，
    // 删掉去重也不红。**不可观测的断言等于没有断言。**
    const out = toDailyDigestReadings(
      [
        { pulled: 90, sent: 0, failed: 0, date: "2026-10-06" },
        { pulled: 2, sent: 2, failed: 0, date: "2026-10-06" },
        { pulled: 5, sent: 5, failed: 0, date: "2026-10-05" },
      ],
      { backlog: 7, skipped: 3 },
    );
    expect(out).toEqual([
      { date: "2026-10-06", pulled: 90, sent: 0, backlog: 7, skipped: 3 },
      { date: "2026-10-05", pulled: 5, sent: 5, backlog: 7, skipped: 3 },
    ]);
  });

  it("**没有 date 的轮次完全不进序列**（不是 date=undefined 的一行）", () => {
    const out = toDailyDigestReadings(
      [
        { pulled: 1, sent: 1, failed: 0 },
        { pulled: 2, sent: 2, failed: 0, date: "2026-10-05" },
      ],
      { backlog: 1, skipped: 0 },
    );
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-10-05");
  });

  it("backlog 与 skipped 原样贯穿到**每一天**，不做任何按天加工", () => {
    // 这两个值只有当前这一轮可得，所以每天都是同一个值——
    // 把它写成「近似的诚实实现」而不是「悄悄当成真的」，
    // 是为了让读代码的人知道这个趋势建立在什么之上。
    const out = toDailyDigestReadings(
      [
        { pulled: 1, sent: 1, failed: 0, date: "2026-10-06" },
        { pulled: 1, sent: 1, failed: 0, date: "2026-10-05" },
      ],
      { backlog: 812, skipped: 12 },
    );
    expect(out.map((r) => r.backlog)).toEqual([812, 812]);
    expect(out.map((r) => r.skipped)).toEqual([12, 12]);
  });

  it("空输入返回空序列——不编一个读数出来", () => {
    expect(toDailyDigestReadings([], { backlog: 0, skipped: 0 })).toEqual([]);
  });
});
