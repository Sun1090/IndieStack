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

    // 这里两轮既没有 `date` 也没有 backlog/skipped（老数据/老 mock），
    // 所以 `trendRounds` 必须是 0、趋势判 INSUFFICIENT_DATA + attention=true——
    // **缺任何一项输入都不给趋势**，而不是拿「同一份 pending」硬凑一个假趋势。
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
      { pulled: 1, sent: 1, failed: 0, date: "2026-10-06", backlog: 8, skipped: 2 },
      { pulled: 2, sent: 2, failed: 0, date: "2026-10-06", backlog: 9, skipped: 2 },
      { pulled: 3, sent: 3, failed: 0, date: "2026-10-05", backlog: 20, skipped: 2 },
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

  it("**趋势用的是每轮自己记下的读数，不是当前快照**（迁移 035 的全部意义）", async () => {
    // 这条是本轮改动的靶心。近似版本里所有天共用 `countMock` 的同一个 pending，
    // 于是 `backlogFalling` 恒为 false、`A05_DRAINING` 与 `BACKLOG_NOT_DRAINING`
    // **结构上永不触发**——面板对「跳过在涨但积压不降」这个 A05 专抓的形态
    // 会给出「一切正常」。
    // 现在两天的 backlog 是 20 → 8、skipped 是 2 → 5，判 A05_DRAINING。
    // **若实现退回当前快照**（两天都用 pending=10、skipped=12），
    // 两个序列差都消失，结论会变成 HEALTHY_LOW_BACKLOG——这条就红了。
    // 这就是它能钉住「近似没有被偷偷改回来」的原因。
    countMock.mockResolvedValue(10);
    oldestMock.mockResolvedValue(null);
    runsMock.mockResolvedValue([
      { pulled: 5, sent: 3, failed: 0, date: "2026-10-06", backlog: 8, skipped: 5 },
      { pulled: 6, sent: 4, failed: 0, date: "2026-10-05", backlog: 20, skipped: 2 },
    ]);
    // 快照侧给一组**会导出另一种结论**的值，确保读侧没有在用它们
    skippedMock.mockResolvedValue({ no_email: 7, preferences_off: 5 });
    readBeforeSendMock.mockResolvedValue(999);

    const reading = await readEmailQueueDiagnostics();
    expect(reading.trendRounds).toBe(2);
    expect(reading.trend.code).toBe("A05_DRAINING");
    expect(reading.trend.attention).toBe(false);
    // reason 里的数字必须来自**那两天各自的读数**，不是快照的 10 / 12
    expect(reading.trend.reason).toContain("积压 20 → 8");
    expect(reading.trend.reason).toContain("跳过 2 → 5");
  });

  it("跳过在涨、积压不降 → 判 BACKLOG_NOT_DRAINING 并且要人看一眼", async () => {
    // 上一版这条只能判到 HEALTHY_LOW_BACKLOG，并且注释里写明
    // 「所有天的 skipped 都被写成同一个当前值，所以这里只能走积压不动的分支」。
    // **那个边界已经不存在了**：现在两笔读数逐轮入表，
    // 这条分支第一次真的可达——而它是 A05 唯一要抓的故障形态。
    countMock.mockResolvedValue(30);
    oldestMock.mockResolvedValue(null);
    runsMock.mockResolvedValue([
      { pulled: 9, sent: 1, failed: 0, date: "2026-10-06", backlog: 30, skipped: 14 },
      { pulled: 9, sent: 6, failed: 0, date: "2026-10-05", backlog: 30, skipped: 3 },
    ]);
    skippedMock.mockResolvedValue({ no_email: 0, preferences_off: 0 });
    readBeforeSendMock.mockResolvedValue(0);

    const reading = await readEmailQueueDiagnostics();
    expect(reading.trend.attention).toBe(true);
    expect(reading.trend.code).toBe("BACKLOG_NOT_DRAINING");
    expect(reading.trend.reason).toContain("跳过在涨");
  });

  it("**backlog/skipped 为 NULL 的轮次连同日期一起排除**（0 不算「没记录」）", async () => {
    // 崩在取数前的那一轮、以及早于迁移 035 的历史行，两列都是 NULL。
    // 拿 0 去补会让「积压降到了 0」成立——那是编出来的趋势。
    // 只有 2026-10-06 那天有完整读数，所以序列长度 1、判不了跨天。
    countMock.mockResolvedValue(10);
    oldestMock.mockResolvedValue(null);
    runsMock.mockResolvedValue([
      { pulled: 5, sent: 3, failed: 0, date: "2026-10-06", backlog: 8, skipped: 5 },
      // 有日期、有计数，但**没有观测读数**
      { pulled: 6, sent: 4, failed: 0, date: "2026-10-05", backlog: undefined, skipped: undefined },
    ]);
    skippedMock.mockResolvedValue({ no_email: 0, preferences_off: 0 });
    readBeforeSendMock.mockResolvedValue(0);

    const reading = await readEmailQueueDiagnostics();
    expect(reading.trendRounds).toBe(1);
    // 单天回落成单轮判定：不给跨天结论，也不谎报「数据不足」之外的东西
    expect(reading.trend.code).toBe("HEALTHY_LOW_BACKLOG");
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
      { pulled: 5, sent: 3, failed: 0, date: "2026-10-06", backlog: 8, skipped: 5 },
      { pulled: 6, sent: 4, failed: 0, date: "2026-10-05", backlog: 20, skipped: 2 },
    ]);
    // no_email=7 + preferences_off=5 = 12，readBeforeSend 却是 999
    skippedMock.mockResolvedValue({ no_email: 7, preferences_off: 5 });
    readBeforeSendMock.mockResolvedValue(999);

    const reading = await readEmailQueueDiagnostics();
    // 两笔账各自进面板字段，一个都不能少
    expect(reading.skippedTotal).toBe(12);
    expect(reading.readBeforeSend).toBe(999);

    // **趋势结论对两组快照读数完全无感**：行里自己的 skipped 是 2 → 5，所以判 A05_DRAINING。
    // 若哪天把 `readBeforeSend`（存量 999）或快照的 `no_email + preferences_off`（12）
    // 混进轮次读数，这个结论必然改变。
    // 上一版只能断言「不该是跳过在涨」——因为所有天共用同一个快照值，
    // 「混进来」与「没混进来」在那个构型下**看不出区别**。
    expect(reading.trend.code).toBe("A05_DRAINING");
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
        { pulled: 90, sent: 0, failed: 0, date: "2026-10-06", backlog: 7, skipped: 3 },
        { pulled: 2, sent: 2, failed: 0, date: "2026-10-06", backlog: 99, skipped: 99 },
        { pulled: 5, sent: 5, failed: 0, date: "2026-10-05", backlog: 20, skipped: 1 },
      ],
    );
    expect(out).toEqual([
      { date: "2026-10-06", pulled: 90, sent: 0, backlog: 7, skipped: 3 },
      { date: "2026-10-05", pulled: 5, sent: 5, backlog: 20, skipped: 1 },
    ]);
  });

  it("**没有 date 的轮次完全不进序列**（不是 date=undefined 的一行）", () => {
    const out = toDailyDigestReadings(
      [
        { pulled: 1, sent: 1, failed: 0, backlog: 1, skipped: 0 },
        { pulled: 2, sent: 2, failed: 0, date: "2026-10-05", backlog: 1, skipped: 0 },
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-10-05");
  });

  it("**backlog/skipped 逐轮来自各自的行**，不再由外部快照贯穿", () => {
    // 这条替换的是「backlog 与 skipped 原样贯穿到每一天，不做任何按天加工」。
    // **那个意图已经过时**：贯穿全序列的同一个值就是假趋势的成因——
    // `backlogFalling` 恒为 false，A05 的两条跨天分支永不触发。
    // 函数签名里也已经没有 `current` 参数可传，留着它等于
    // 给下一个人留一条回到近似的路。
    const out = toDailyDigestReadings([
      { pulled: 1, sent: 1, failed: 0, date: "2026-10-06", backlog: 812, skipped: 12 },
      { pulled: 1, sent: 1, failed: 0, date: "2026-10-05", backlog: 900, skipped: 4 },
    ]);
    expect(out.map((r) => r.backlog)).toEqual([812, 900]);
    expect(out.map((r) => r.skipped)).toEqual([12, 4]);
  });

  it("**没有观测读数的轮次不进序列**，也不被 0 顶替", () => {
    // 崩在取数前的一轮、以及迁移 035 之前的历史行，都属于「没记录到」。
    // （repository 侧把 NULL 归一成 `undefined`，见 `worker-runs.test.ts` 那两条钉子，
    //  所以纯函数这一层看到的是 `undefined`。）
    // 这条守的是 `?? 0` 之类的兜底不能被加回来：一旦加回来，
    // backlog=0 会让 `judgeDigestRound` 当场判成「队列已清空」。
    // 注意第二行的 skipped 是**真实的 0**，它必须留在序列里。
    const out = toDailyDigestReadings([
      { pulled: 3, sent: 3, failed: 0, date: "2026-10-06" },
      { pulled: 2, sent: 2, failed: 0, date: "2026-10-05", backlog: 30, skipped: 0 },
    ]);
    expect(out).toEqual([{ date: "2026-10-05", pulled: 2, sent: 2, backlog: 30, skipped: 0 }]);
  });

  it("空输入返回空序列——不编一个读数出来", () => {
    expect(toDailyDigestReadings([])).toEqual([]);
  });
});
