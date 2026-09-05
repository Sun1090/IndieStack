/**
 * 邮件 worker 运行记录数据访问层（v0.5.0 C02，迁移 017）
 * 每次 cron digest 执行落一行，供 admin 看板与积压排查；
 * 仅受信服务端上下文调用（service_role 绕过 RLS）。
 */
import { createAdminClient } from "@/lib/supabase/admin";

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
