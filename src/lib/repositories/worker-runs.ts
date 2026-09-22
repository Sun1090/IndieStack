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
  });
  if (error) throw new Error(error.message);
}

/**
 * 最近若干轮 worker 运行（A05 可观测）：新→旧，只要算「空发送轮次」用得上的三列。
 * 默认 20 轮≈三周的日调度；放大到全量没有意义，卡的判断看的是队列年龄。
 */
export async function listRecentEmailWorkerRuns(
  limit = 20,
): Promise<EmailWorkerRunRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_worker_runs")
    .select("pulled, sent, failed")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { pulled?: number; sent?: number; failed?: number }[]).map((row) => ({
    pulled: row.pulled ?? 0,
    sent: row.sent ?? 0,
    failed: row.failed ?? 0,
  }));
}
