/**
 * 邮件待发队列的可观测口径（v0.12.0 A05 的前半：先看得见，再决定怎么出队）。
 *
 * 为什么单独成模块：出队语义（v0.12.0 A05 的后半）2026-09-25 已定案为「新增原因列、
 * 判定当场出队」，但**读数与写入仍然分在这里**，因为面板说的必须是 worker 看到的那支队伍。
 * 这个模块只做不涉及 I/O 的四件事：队列有多少条、最老一条卡了多久、
 * 最近有多少轮「拉到东西却一封没发出去」，以及两种「不会再寄出」各行其原因。
 *
 * 「空发送轮次」刻意只数 `pulled>0 && sent===0 && failed===0` 那一类：`failed>0` 已经由 A04
 * 的跳过可见性与 `email_attempts` 表达，把它混进来会让「投递失败」和「根本没有可投递的对象」
 * 两种完全不同的故障共用一个数字。
 */

import { EMAIL_SKIP_REASONS } from "@/lib/notifications/types";
import type { EmailSkipReason } from "@/lib/notifications/types";

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
  /**
   * 已经因为「根本寄不出去」离开队列的行，按原因计数（A05）。
   * 没出现过的原因视为 0——这里不收 `undefined` 以外的默认值，调用方必须显式给一个对象，
   * 因为「面板没这一栏」和「这一栏是 0」是两件不同的事。
   */
  skippedByReason: Partial<Record<EmailSkipReason, number>>;
  /**
   * 站内先被读过、因此再也不会被摘要寄出的条数（`countReadBeforeSendEmailNotifications`）。
   * 这条出队路径不经 `email_sent` 也不经原因列，只看 `pending` 的人看不见它。
   */
  readBeforeSend: number;
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
  /** 原样透传，但每个登记过的原因都有一个数（缺的补 0）。 */
  skippedByReason: Record<EmailSkipReason, number>;
  /** `skippedByReason` 各项之和：因为「寄不出去」而离开队列的总行数。 */
  skippedTotal: number;
  readBeforeSend: number;
}

export function deriveQueueDiagnostics(input: QueueDiagnosticsInput): QueueDiagnostics {
  const oldestAgeMs =
    input.pending > 0 && input.oldestCreatedAt !== null
      ? Math.max(0, input.nowMs - Date.parse(input.oldestCreatedAt))
      : null;

  const emptySendRounds = input.recentRuns.filter(
    (run) => run.pulled > 0 && run.sent === 0 && run.failed === 0,
  ).length;

  // 计数以登记的集合为准，而不是以调用方塞进来的键为准：多出来的键直接丢掉，
  // 否则一个新原因会在面板上悄悄少一栏，而那一栏正是「为什么队列里有它」。
  const skippedByReason = {} as Record<EmailSkipReason, number>;
  for (const reason of EMAIL_SKIP_REASONS) {
    skippedByReason[reason] = input.skippedByReason[reason] ?? 0;
  }
  const skippedTotal = EMAIL_SKIP_REASONS.reduce((sum, reason) => sum + skippedByReason[reason], 0);

  return {
    pending: input.pending,
    oldestAgeMs,
    emptySendRounds,
    stale: oldestAgeMs !== null && oldestAgeMs >= PENDING_STALE_MS,
    skippedByReason,
    skippedTotal,
    readBeforeSend: input.readBeforeSend,
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
