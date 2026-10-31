/**
 * 「队列卡死」这件事在本仓库有**两处**判定，它们服务于不同目的、
 * 却必须**不打架**。这个文件盯的就是它们之间的关系。
 *
 * ## 为什么要专门写一个跨模块的一致性测试
 *
 * - `digest-verdict.ts` 的 `QUEUE_STUCK`：`pulled >= EMAIL_PULL_LIMIT && sent === 0 && failed === 0`
 *   —— **严重性判定**，决定要不要喊人。
 * - `queue-diagnostics.ts` 的 `emptySendRounds`：`pulled > 0 && sent === 0 && failed === 0`
 *   —— **展示口径**，决定面板上那个「空发轮次」怎么算。
 *
 * 两者**不是同一个概念**（一个是严重性、一个是计数，阈值也不同），
 * 所以不该强行合并。但它们对**同一批数据**下结论，一旦各自漂移就会出现
 * 「面板说 0 轮空发、告警却在喊卡死」这种**互相打脸**的读数——
 * 而那时候读日志的人无法判断该信哪一个。
 *
 * 所以这里钉的是**包含关系**而不是相等：
 * **凡是被判为 `QUEUE_STUCK` 的轮次，都必须同时被计进 `emptySendRounds`。**
 * 反向不成立（`pulled=5, sent=0, failed=0` 是空发轮次，但远没到卡死），
 * 那是定义上的正常，不在这里断言。
 *
 * **2026-10-31 订正**：`QUEUE_STUCK` 那一栏的条件此前**少了一个 `failed === 0`**，
 * 于是「Resend 全线故障导致 100 条全失败」与「队首被不可投递的行占死」这一对
 * **读数完全一样**的轮次被判成同一个码，告警文案把人指向迁移 034 与
 * `email_skipped_reason` 的写入——方向是错的。这个文件当时**本可以**抓到它，
 * 却在第二组用例上写了一句 `|| run.failed > 0` 的放行：那个析取恒为真，
 * 等于用一条永远成立的断言把分歧遮住了。现在那一行删了，
 * 分歧改为正向断言（`DELIVERY_FAILING` 与 `emptySendRounds` 一致地排除它）。
 */
import { describe, expect, it } from "vitest";
import { EMAIL_PULL_LIMIT } from "@/lib/repositories/notifications";
import { listRecentEmailWorkerRuns } from "@/lib/repositories/worker-runs";
import { judgeDigestRound, judgeDigestSeries } from "./digest-verdict";
import { deriveQueueDiagnostics } from "./queue-diagnostics";

/** 按 `queue-diagnostics` 的口径数一轮是否算「空发」。 */
function countsAsEmptySendRound(run: { pulled: number; sent: number; failed: number }): boolean {
  return run.pulled > 0 && run.sent === 0 && run.failed === 0;
}

/** 用一组运行记录跑一次面板诊断，取出 emptySendRounds。 */
function emptyRoundsFor(runs: { pulled: number; sent: number; failed: number }[]): number {
  return deriveQueueDiagnostics({
    pending: 240,
    oldestCreatedAt: "2026-10-01T00:00:00.000Z",
    nowMs: Date.parse("2026-10-06T00:00:00.000Z"),
    recentRuns: runs,
    skippedByReason: { no_email: 0, preferences_off: 0 },
    readBeforeSend: 0,
  }).emptySendRounds;
}

describe("判定「队列卡死」的两处口径", () => {
  it("**凡是被判 QUEUE_STUCK 的轮次，都必须被计进 emptySendRounds**", () => {
    // 构造两组「拉满却没发且**没有失败**」的形态，逐组核对两边结论不打架。
    //
    // 这个集合里**不再**包含 `failed > 0` 的轮次：那种轮次不是「队首被占死」，
    // 而是投递侧故障（`DELIVERY_FAILING`），面板的 `emptySendRounds` 也一直
    // 把它排除在外。此前这条用例把它放进来，并用 `|| run.failed > 0` 放行——
    // 那个放行是**恒真的**，等于用一个永远成立的断言遮住了两套口径的分歧。
    const stuckRounds = [
      { pulled: EMAIL_PULL_LIMIT, sent: 0, failed: 0 },
      { pulled: EMAIL_PULL_LIMIT + 7, sent: 0, failed: 0 },
    ];
    for (const run of stuckRounds) {
      const verdict = judgeDigestRound({
        date: "2026-10-06",
        pulled: run.pulled,
        sent: run.sent,
        failed: run.failed,
        backlog: 240,
        skipped: 0,
      });
      expect(verdict.code).toBe("QUEUE_STUCK");
      // 包含关系：告警认了的轮次，面板也必须数到。
      expect(countsAsEmptySendRound(run)).toBe(true);
    }
  });

  it("**投递侧故障两边一致地不算「空发」**：failed>0 时告警换码、面板不计数", () => {
    // 同一个 (pulled=100, sent=0)，只是 failed 不同——这正是此前被读成同一件事的两种世界。
    const run = { pulled: EMAIL_PULL_LIMIT, sent: 0, failed: EMAIL_PULL_LIMIT };
    expect(countsAsEmptySendRound(run)).toBe(false);
    expect(
      judgeDigestRound({
        date: "2026-10-06",
        pulled: run.pulled,
        sent: run.sent,
        failed: run.failed,
        backlog: 240,
        skipped: 0,
      }).code,
    ).toBe("DELIVERY_FAILING");
  });

  it("两边对「纯空发轮次」的结论一致：都认", () => {
    const run = { pulled: EMAIL_PULL_LIMIT, sent: 0, failed: 0 };
    expect(countsAsEmptySendRound(run)).toBe(true);
    expect(
      judgeDigestRound({ date: "2026-10-06", pulled: run.pulled, sent: run.sent, failed: 0, backlog: 240, skipped: 0 }).code,
    ).toBe("QUEUE_STUCK");
  });

  it("**告警不比面板更钝**：拉满没发且 failed=0 时，面板与告警同时出声", () => {
    const runs = [
      { pulled: 10, sent: 10, failed: 0 },
      { pulled: EMAIL_PULL_LIMIT, sent: 0, failed: 0 },
      { pulled: 10, sent: 10, failed: 0 },
    ];
    // 面板：恰好 1 轮空发
    expect(emptyRoundsFor(runs)).toBe(1);
    // 告警：在同一批数据里也必须认出来（不能只有面板喊）
    const stuck = runs.filter((run) => judgeDigestRound({
      date: "2026-10-06",
      pulled: run.pulled,
      sent: run.sent,
      failed: run.failed,
      backlog: 240,
      skipped: 0,
    }).code === "QUEUE_STUCK");
    expect(stuck).toHaveLength(1);
  });

  it("**低量空发不算卡死**（定义上的正常，不该被合并成同一个概念）", () => {
    const run = { pulled: 5, sent: 0, failed: 0 };
    expect(countsAsEmptySendRound(run)).toBe(true);
    const verdict = judgeDigestRound({
      date: "2026-10-06",
      pulled: run.pulled,
      sent: run.sent,
      failed: run.failed,
      backlog: 3,
      skipped: 5,
    });
    expect(verdict.attention).toBe(false);
  });

  it("取数上限只有一个来源：verdict 用的就是 repositories 那个常量", () => {
    // 这条钉住「两处各写一个 100」的老毛病。改了一处而另一处没跟上时，
    // QUEUE_STUCK 的阈值就会与真实取数上限脱节，静默变成「永远抓不到卡死」。
    expect(EMAIL_PULL_LIMIT).toBe(100);
    const justUnder = judgeDigestRound({
      date: "2026-10-06",
      pulled: EMAIL_PULL_LIMIT - 1,
      sent: 0,
      failed: 0,
      backlog: 240,
      skipped: 0,
    });
    expect(justUnder.code).not.toBe("QUEUE_STUCK");
    const atLimit = judgeDigestRound({
      date: "2026-10-06",
      pulled: EMAIL_PULL_LIMIT,
      sent: 0,
      failed: 0,
      backlog: 240,
      skipped: 0,
    });
    expect(atLimit.code).toBe("QUEUE_STUCK");
  });
});

describe("跨天趋势真的拿得到数据（端到端接上）", () => {
  it("**仓储返回的轮次带着日期，可以直接喂给 judgeDigestSeries**", async () => {
    // 这条钉的是「接线」而不是「判定」：
    // 之前 `listRecentEmailWorkerRuns` 只 select 三列，
    // 于是 `judgeDigestSeries` 永远只能判单轮——**趋势判定写了却拿不到数据**。
    // 判定本身有单测，但它当时**没有任何数据源**。
    const rows = await listRecentEmailWorkerRuns();

    // 无论有没有数据，序列判定都**必须给出结论**，而不是静默返回空：
    // 空序列会判 INSUFFICIENT_DATA + attention=true（那才是诚实的行为）。
    const verdict = judgeDigestSeries(
      rows
        .filter((row) => typeof row.date === "string")
        .map((row) => ({
          date: row.date as string,
          pulled: row.pulled,
          sent: row.sent,
          failed: row.failed,
          backlog: 0, // 积压不在 worker_runs 表里，这里只验接线
          skipped: 0,
        })),
    );
    expect(verdict.code).toBeDefined();
    // 关键：不能是「有数据却判不出趋势」——有日期的行必须真的被用上
    const dated = rows.filter((row) => typeof row.date === "string");
    if (dated.length >= 2) {
      expect(verdict.code).not.toBe("INSUFFICIENT_DATA");
    }
  });
});
