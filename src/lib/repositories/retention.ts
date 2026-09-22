/**
 * 平台侧保留期清理（不依赖 pg_cron）
 *
 * 迁移 `003` / `014` / `027` / `032` 定义了 6 个 `security definer` 清理函数，并把它们
 * 注册进 pg_cron——但那些调度块写成 `if exists (select 1 from pg_extension where extname
 * = 'pg_cron')`，而本地与云端项目都没有安装 pg_cron：迁移成功、门禁全绿、`cron.job`
 * 关系根本不存在，于是一行都不会删。隐私声明里的保留天数因此只是一份承诺。
 *
 * 本模块负责兑现它：由 `/api/cron/retention` 每天调用一次，用 service_role 逐个执行
 * 迁移里已经定义好的函数。**删除逻辑不在这里**——时间窗、状态谓词、撤权边界仍然只有
 * 迁移 SQL 一个事实源，应用侧只是那条 SQL 的调度器。pg_cron 日后被启用也只是重复执行：
 * 每个函数的条件都是 `now() - <retention>`，多跑一次不改变结果。
 *
 * 逐个调用而非并发：这些都是全表范围的删除，在免费层实例上同时压六个删除只会互相等锁。
 * 单个函数失败不中断整轮——一批过期数据留着下轮再删，远比整轮报废好；失败逐个上报指标。
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

/** 迁移里登记的清理函数名；字面量列出，便于 `admin-client-boundary` 静态审计 RPC 白名单。 */
type RetentionCleanupFunction =
  | "cleanup_old_notifications"
  | "cleanup_old_webhook_events"
  | "cleanup_old_email_worker_runs"
  | "cleanup_old_api_usage"
  | "prune_deleted_upload_objects"
  | "cleanup_resolved_contact_messages";

/** 与 `Database["public"]["Functions"]` 对齐：函数从迁移里消失时这里先编译失败。 */
export const RETENTION_CLEANUP_FUNCTIONS = [
  "cleanup_old_notifications",
  "cleanup_old_webhook_events",
  "cleanup_old_email_worker_runs",
  "cleanup_old_api_usage",
  "prune_deleted_upload_objects",
  "cleanup_resolved_contact_messages",
] as const satisfies readonly (keyof Database["public"]["Functions"])[];

export interface RetentionSweepFailure {
  /** 失败的清理函数名（不含用户或环境数据，可安全作为指标维度）。 */
  cleanupFunction: RetentionCleanupFunction;
  message: string;
}

export interface RetentionSweepResult {
  /** 成功执行的函数数量。 */
  ran: number;
  failures: RetentionSweepFailure[];
}

/**
 * 执行全部保留期清理。
 *
 * 返回逐个结果而不是抛错：调用方（cron 路由）据此决定「整轮都没跑成」与「部分失败」，
 * 两者运维含义不同——前者通常是 `CRON_SECRET` 之外的数据库侧事故，后者往往只是
 * 某张表的权限或索引问题。
 */
export async function runRetentionSweeps(): Promise<RetentionSweepResult> {
  const admin = createAdminClient();
  const failures: RetentionSweepFailure[] = [];
  let ran = 0;

  for (const cleanupFunction of RETENTION_CLEANUP_FUNCTIONS) {
    const { error } = await admin.rpc(cleanupFunction);
    if (error) {
      failures.push({ cleanupFunction, message: error.message });
      continue;
    }
    ran += 1;
  }

  return { ran, failures };
}
