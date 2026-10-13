/**
 * 邮件 worker 运行记录数据访问层（v0.5.0 C02，迁移 017）
 * 每次 cron digest 执行落一行，供 admin 看板与积压排查；
 * 仅受信服务端上下文调用（service_role 绕过 RLS）。
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { EmailWorkerRunRow } from "@/lib/notifications/queue-diagnostics";

export interface WorkerRunInput {
  pulled: number;
  sent: number;
  groups: number;
  failed: number;
  durationMs: number;
  error?: string | null;
  /**
   * 本轮开始时的待发条数（迁移 035）。**不给默认 0**：
   * `undefined` 表示这一轮没记录到该读数（崩在取数之前），
   * 写成 0 等于宣称「空队列时崩的」，而 `judgeDigestSeries` 会拿它算出「积压已清零」。
   */
  backlog?: number | null;
  /** 本轮按用户条件跳过的条数（迁移 035）。同上，`undefined`/`null` = 本轮没记录到。 */
  skipped?: number | null;
}

export async function recordWorkerRun(input: WorkerRunInput): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("email_worker_runs").insert({
    pulled: input.pulled,
    sent: input.sent,
    groups: input.groups,
    failed: input.failed,
    duration_ms: input.durationMs,
    error: input.error ?? null,
    // **保持 null 而不是 0**：这两列的 NULL 语义由迁移 035 定义（本轮未记录到），
    // 在写侧填 0 会把「不知道」伪装成「读数是 0」，而这正是趋势判定唯一无法分辨的错误。
    backlog: input.backlog ?? null,
    skipped: input.skipped ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * 最近若干轮 worker 运行（A05 可观测）。
 *
 * 取哪些列、为什么：
 * - `pulled/sent/failed`：算「空发送轮次」（单轮计数）。
 * - `created_at`：跨天趋势判定需要日期（迁移 017 就有，只是曾经没 select）。
 * - `backlog`/`skipped`：跨天趋势判定的另外两个输入（迁移 035）。**必须按轮各自取**，
 *   不能用当前一次读数贯穿全序列——那样 `backlogFalling` 结构上永远为 false，
 *   `A05_DRAINING` / `BACKLOG_NOT_DRAINING` 两条分支永不触发，
 *   而面板会对着一个假读数说「一切正常」。
 *
 * 默认 20 轮≈三周的日调度；放大到全量没有意义，卡的判断看的是队列年龄。
 */
export async function listRecentEmailWorkerRuns(
  limit = 20,
): Promise<EmailWorkerRunRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_worker_runs")
    // **created_at 一起取**：跨天趋势判定（`judgeDigestSeries`）需要日期，
    // 而「没有日期的轮次」只能判单轮。列早就存在（迁移 017，已建索引），只是没 select。
    .select("pulled, sent, failed, created_at, backlog, skipped")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    pulled?: number;
    sent?: number;
    failed?: number;
    created_at?: string;
    backlog?: number | null;
    skipped?: number | null;
  }[]).map((row) => ({
    pulled: row.pulled ?? 0,
    sent: row.sent ?? 0,
    failed: row.failed ?? 0,
    date: typeof row.created_at === "string" ? row.created_at.slice(0, 10) : undefined,
    // **null 归一成 undefined**：与 `date` 同一条口径——「这轮没有这个读数」。
    // 计数三列缺列按 0（那一轮确实没发/没失败），而这两列缺列**不能**按 0，
    // 因为 0 在这里是一个有含义的读数（空队列 / 零跳过）。
    backlog: row.backlog ?? undefined,
    skipped: row.skipped ?? undefined,
  }));
}
