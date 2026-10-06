/**
 * 待发队列读数的组装（v0.12.0 A05 前半的服务端一侧）。
 *
 * 单独成模块有两个原因：① `Date.now()` 必须有一个非组件宿主——放在 Server Component 里
 * 会被 `react-hooks/purity` 拦下，而把时钟塞进模块顶层又会让年龄从进程启动起就不动；
 * ② 面板要的从来不是几段查询，而是「同一口径下的几个读数」，所以拼装只有一处。
 * 规则本体在 `queue-diagnostics.ts`（纯函数，不碰 Supabase 也不读时钟）。
 */
import {
  countEmailSkippedByReason,
  countReadBeforeSendEmailNotifications,
  countUnsentEmailNotifications,
  oldestUnsentEmailCreatedAt,
} from "@/lib/repositories/notifications";
import { listRecentEmailWorkerRuns } from "@/lib/repositories/worker-runs";
import {
  deriveQueueDiagnostics,
  type EmailWorkerRunRow,
  type QueueDiagnostics,
} from "./queue-diagnostics";
import { judgeDigestSeries, type DigestRoundReading, type DigestVerdict } from "./digest-verdict";

/**
 * 面板用的完整读数 = 队列诊断 + **跨天趋势结论**。
 *
 * **为什么两者要并列而不是只留一个**：它们回答的是不同问题。
 * `emptySendRounds` 答「最近有几轮什么都没发出去」（单轮计数），
 * 趋势判定答「积压是在**降**还是**不降**」（跨天）。
 * 只摆前者，面板就会出现这种读数：「0 轮空发」+ 一个没人解释的 `pending=812`——
 * 而**没有一个字段解释这个数字为什么降不下去**。摆在一起，矛盾就一眼可见。
 */
export interface EmailQueueReading extends QueueDiagnostics {
  /** 跨天趋势结论；`attention=true` 时面板应当显式提示。 */
  trend: DigestVerdict;
  /** 参与趋势判定的天数（`recentRuns` 里带日期的那些，按天去重后）。 */
  trendRounds: number;
}

/**
 * 把「每轮一行」的 worker 运行记录压成「每天一个读数」。
 *
 * **抽成独立纯函数的原因（踩过的坑）**：这段映射一开始内联在取数函数里，
 * 结果两条关键性质**在测试里都不可观测**——同一天的多轮计数相同，
 * 于是「去掉了去重」看不出差别；所有天共用同一个 skipped 值，
 * 于是「把 readBeforeSend 混进 skipped」也看不出差别。
 * **两个变异都全绿**，而那正是「一个永远不失败的门禁比没有门禁更糟」。
 * 抽出来之后两件事都能被直接断言（下面单测就是钉它们的）。
 *
 * 两条性质：
 * ① **按天去重，保留当天最新的一轮**（`recentRuns` 是从新到旧）。
 *    不去重的话同日期多轮会让 `judgeDigestSeries` 判「重复日期 → 数据不足」，
 *    而那不是数据不足，是**接线把数据搞坏了**。
 * ② **没有 `date` 的轮次直接不参与**。宁可没有趋势，
 *    也不能拿同一份 backlog 硬凑一个只有一天的假趋势。
 *
 * **必须说清的近似**：`backlog` 与 `skipped` 只有当前这一轮的取值，
 * 所以序列里每一天都用同一个值。**这是近似不是真趋势**——
 * 所以调用方要把 `trendRounds` 一起给出去，
 * 一个只基于两天的「趋势」不该被当成趋势展示。
 */
export function toDailyDigestReadings(
  recentRuns: readonly EmailWorkerRunRow[],
  current: { backlog: number; skipped: number },
): DigestRoundReading[] {
  const daily = new Map<string, EmailWorkerRunRow>();
  for (const run of recentRuns) {
    if (typeof run.date !== "string") continue;
    if (daily.has(run.date)) continue;
    daily.set(run.date, run);
  }
  return [...daily].map(([date, run]) => ({
    date,
    pulled: run.pulled,
    sent: run.sent,
    backlog: current.backlog,
    skipped: current.skipped,
  }));
}

export async function readEmailQueueDiagnostics(): Promise<EmailQueueReading> {
  const [pending, oldestCreatedAt, recentRuns, skippedByReason, readBeforeSend] =
    await Promise.all([
      countUnsentEmailNotifications(),
      oldestUnsentEmailCreatedAt(),
      listRecentEmailWorkerRuns(),
      // A05：两笔「已经离开队列」的账。一笔是 worker 当场判定寄不出去（写了原因），
      // 一笔是用户在站内先读掉了（队列条件含 `is_read=false`）。后者不经任何指标，
      // 只看 `pending` 会把「越堵」读成「越小」，所以它必须和积压数同批取。
      countEmailSkippedByReason(),
      countReadBeforeSendEmailNotifications(),
    ]);
  const diagnostics = deriveQueueDiagnostics({
    pending,
    oldestCreatedAt,
    recentRuns,
    skippedByReason,
    readBeforeSend,
    nowMs: Date.now(),
  });

  const daily = toDailyDigestReadings(recentRuns, {
    backlog: pending,
    // 只取 worker 口径的两笔原因；`readBeforeSend` 是「用户在站内读掉了」，
    // 不经 worker，混进来会让「跳过在涨」这件事建立在另一个口径上。
    skipped: skippedByReason.no_email + skippedByReason.preferences_off,
  });

  return {
    ...diagnostics,
    trend: judgeDigestSeries(daily),
    trendRounds: daily.length,
  };
}
