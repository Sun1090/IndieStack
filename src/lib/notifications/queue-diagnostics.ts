/**
 * 邮件待发队列的可观测口径（v0.12.0 A05 的前半：先看得见，再决定怎么出队）。
 *
 * 为什么单独成模块：出队语义（复用死信 / 新增过滤列 / 拉取侧翻页）是一个待定的产品决策，
 * 但**在看清规模之前讨论那个决策等于猜**。这里只做不涉及语义的三件事：
 * 队列有多少条、最老一条卡了多久、最近有多少轮「拉到东西却一封没发出去」。
 *
 * 「空发送轮次」刻意只数 `pulled>0 && sent===0 && failed===0` 那一类：`failed>0` 已经由 A04
 * 的跳过可见性与 `email_attempts` 表达，把它混进来会让「投递失败」和「根本没有可投递的对象」
 * 两种完全不同的故障共用一个数字。
 */

/** 摘要按天调度：跨过两个周期还没发出去，就不是「再等下一轮」，而是卡在队列头部。 */
export const PENDING_STALE_HOURS = 48;
export const PENDING_STALE_MS = PENDING_STALE_HOURS * 60 * 60 * 1000;

export interface EmailWorkerRunRow {
  pulled: number;
  sent: number;
  failed: number;
}

export interface QueueDiagnosticsInput {
  /** 同一过滤口径下的待发条数（`countUnsentEmailNotifications`）。 */
  pending: number;
  /** 最老一条待发通知的 `created_at`；队列为空时为 null。 */
  oldestCreatedAt: string | null;
  /** 最近若干轮 worker 运行记录，顺序不参与计算。 */
  recentRuns: EmailWorkerRunRow[];
  /** 由调用方注入，纯函数不读时钟。 */
  nowMs: number;
}

export interface QueueDiagnostics {
  pending: number;
  /** 最老一条的年龄（毫秒）；没有待发条目时为 null。 */
  oldestAgeMs: number | null;
  /** 「拉到东西却一封没发出去、也没报错」的轮次数。 */
  emptySendRounds: number;
  /** 有积压且最老一条已超过两个调度周期。 */
  stale: boolean;
}

export function deriveQueueDiagnostics(input: QueueDiagnosticsInput): QueueDiagnostics {
  const oldestAgeMs =
    input.pending > 0 && input.oldestCreatedAt !== null
      ? Math.max(0, input.nowMs - Date.parse(input.oldestCreatedAt))
      : null;

  const emptySendRounds = input.recentRuns.filter(
    (run) => run.pulled > 0 && run.sent === 0 && run.failed === 0,
  ).length;

  return {
    pending: input.pending,
    oldestAgeMs,
    emptySendRounds,
    stale: oldestAgeMs !== null && oldestAgeMs >= PENDING_STALE_MS,
  };
}

/**
 * 把年龄折成「分钟 / 小时 / 天」三档的**数值与单位档**，不拼字符串：
 * 单位词属于文案，归 `messages/{locale}/admin.json`；这里只保证分档口径唯一
 * （面板与告警说的是同一个「卡了多久」）。天档的起点与 {@link PENDING_STALE_HOURS} 同刻度，
 * 否则会出现「显示 1 天却已经 stale」这类自相矛盾的读数。
 */
export type PendingAgeUnit = "minutes" | "hours" | "days";

export interface PendingAgeParts {
  value: number;
  unit: PendingAgeUnit;
}

export function describePendingAge(ageMs: number | null): PendingAgeParts | null {
  if (ageMs === null) return null;
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 60) return { value: minutes, unit: "minutes" };
  const hours = Math.floor(minutes / 60);
  if (hours < PENDING_STALE_HOURS) return { value: hours, unit: "hours" };
  return { value: Math.floor(hours / 24), unit: "days" };
}
