/**
 * Web Push 持久化投递数据访问层（v0.8.0，迁移 026）
 *
 * 每个 (notification_id, endpoint) 一行，记录单个浏览器端点的投递结果：
 *   - pending：待投递 / 退避重试中，由 cron worker 按 next_attempt_at 拉取
 *   - sent   ：已成功投递
 *   - dead   ：死信（超过重试上限或端点永久失效），不再拉取
 *
 * 语义与邮件 `metadata.email_attempts`（上限 3）对齐；仅受信服务端上下文调用，
 * service_role 绕过 RLS，不对 anon/authenticated 开放策略。
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export type PushDeliveryAttempt =
  Database["public"]["Tables"]["push_delivery_attempts"]["Row"];

export type PushDeliveryStatus = "pending" | "sent" | "dead";

/** 失败原因（机器可读），写入 failure_code 供死信分类与失效端点统计 */
export type PushFailureCode =
  | "subscription-gone"
  | "subscription-missing"
  | "notification-missing"
  | "max-attempts"
  | "max-age"
  | "retry-write-failed"
  | "timeout"
  | "network"
  | string;

/** 重试上限（含首次即时投递）：达到后进入死信，不再被 worker 拉取（与邮件一致） */
export const PUSH_MAX_ATTEMPTS = 3;

/**
 * 一行 pending 允许存活的最长时间，超过即按 `max-age` 进死信。
 *
 * 重试上限本身是靠 `attempt_count` 表达的，而这个计数器只有在**重排回执写成功**时才会前进：
 * `markPushDeliveryRetry` 抛错时引擎只会上报并继续，行仍是 pending、`next_attempt_at` 仍是过去
 * 时间、计数器冻结不动——下一轮它又被拉到队首，永远到不了 `PUSH_MAX_ATTEMPTS`。所以这条界必须
 * 落在一个写入失败也动不了的时间戳上，`created_at`（入队时定死）就是这样一个事实。
 *
 * 取 7 天而不是「几次退避的总和」：worker 每天 22:00 UTC 才跑一轮（Hobby 每日一次），
 * `PUSH_MAX_ATTEMPTS=3` 在健康路径上最长也要跨三天才走完，7 天留出足够余量，
 * 又保证任何冻结的行不会永远占着按 `next_attempt_at` 升序拉取的队首。
 */
export const PUSH_RETRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** 退避基数：首次失败 60s 后重试，其后指数翻倍 */
export const PUSH_BACKOFF_BASE_MS = 60_000;

/** 退避上限，避免长任务被推到过远 */
export const PUSH_BACKOFF_CAP_MS = 60 * 60_000;

/** 待重试队列积压告警阈值（cron 上报 Sentry） */
export const PUSH_BACKLOG_ALERT_THRESHOLD = 500;

/** sent 回执保留天数：终态只用于短期排查，过期清理避免队列表无限增长 */
export const PUSH_SENT_RETENTION_DAYS = 7;

/** dead 行保留天数：死信保留更久，供端点质量分析与人工排查 */
export const PUSH_DEAD_RETENTION_DAYS = 30;

/** 单轮单状态最多清理行数，避免一次删除锁表过久 */
export const PUSH_PRUNE_BATCH_LIMIT = 1000;

/** 端点永久失效的 failure_code：push service 拒绝（404/410）或订阅记录已不存在 */
export const INVALID_PUSH_ENDPOINT_CODES = ["subscription-gone", "subscription-missing"] as const;

/** 指数退避毫秒数：attemptCount=1 → 60s，2 → 120s，随后翻倍至 1 小时封顶 */
export function pushBackoffMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.trunc(attemptCount) - 1);
  return Math.min(PUSH_BACKOFF_CAP_MS, PUSH_BACKOFF_BASE_MS * 2 ** exponent);
}

export interface PushDeliveryTarget {
  subscriptionId: string;
  endpoint: string;
}

/**
 * 幂等入队：为一次通知的每个端点写入 pending 行。
 * 唯一键 (notification_id, endpoint) + ignoreDuplicates 保证重复入队不会重置
 * 已 sent/dead 的历史，也不会重复推送给同一端点。
 */
export async function enqueuePushDeliveryAttempts(
  notificationId: string,
  userId: string,
  targets: PushDeliveryTarget[],
  now: Date = new Date(),
): Promise<void> {
  if (targets.length === 0) return;
  const admin = createAdminClient();
  // 给即时投递留出一个退避窗口，避免 cron 在首次投递尚未完成时重复拉取；
  // 若进程在即时投递前崩溃，该行仍会在窗口结束后被 worker 接管。
  const firstRetryAt = new Date(now.getTime() + PUSH_BACKOFF_BASE_MS).toISOString();
  const { error } = await admin.from("push_delivery_attempts").upsert(
    targets.map((target) => ({
      notification_id: notificationId,
      user_id: userId,
      push_subscription_id: target.subscriptionId,
      endpoint: target.endpoint,
      next_attempt_at: firstRetryAt,
    })),
    { onConflict: "notification_id,endpoint", ignoreDuplicates: true },
  );
  if (error) throw new Error(`push delivery enqueue: ${error.message}`);
}

/** 到期待重试行（pending 且 next_attempt_at <= now），按到期时间升序，供 cron worker 拉取 */
export async function listDuePushDeliveryAttempts(
  limit = 50,
  now: Date = new Date(),
): Promise<PushDeliveryAttempt[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("push_delivery_attempts")
    .select("*")
    .eq("status", "pending")
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`push delivery due list: ${error.message}`);
  return (data ?? []) as PushDeliveryAttempt[];
}

/** 投递成功回执：标记 sent，记录次数与时间，清空历史失败信息 */
export async function markPushDeliverySent(
  notificationId: string,
  endpoint: string,
  attemptCount: number,
  now: Date = new Date(),
): Promise<void> {
  const admin = createAdminClient();
  const timestamp = now.toISOString();
  const { error } = await admin
    .from("push_delivery_attempts")
    .update({
      status: "sent",
      attempt_count: attemptCount,
      failure_code: null,
      last_error: null,
      last_attempt_at: timestamp,
      sent_at: timestamp,
    })
    .eq("notification_id", notificationId)
    .eq("endpoint", endpoint);
  if (error) throw new Error(`push delivery sent: ${error.message}`);
}

export interface PushDeliveryRetryInput {
  attemptCount: number;
  nextAttemptAt: Date;
  failureCode: PushFailureCode;
  error?: string | null;
}

/** 瞬时失败回执：保持 pending，写入退避后的下次尝试时间，由 cron 重试 */
export async function markPushDeliveryRetry(
  notificationId: string,
  endpoint: string,
  input: PushDeliveryRetryInput,
  now: Date = new Date(),
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("push_delivery_attempts")
    .update({
      status: "pending",
      attempt_count: input.attemptCount,
      failure_code: input.failureCode,
      last_error: input.error ?? null,
      last_attempt_at: now.toISOString(),
      next_attempt_at: input.nextAttemptAt.toISOString(),
    })
    .eq("notification_id", notificationId)
    .eq("endpoint", endpoint);
  if (error) throw new Error(`push delivery retry: ${error.message}`);
}

/** 死信回执：超过上限或端点永久失效，置为 dead 不再拉取 */
export async function markPushDeliveryDead(
  notificationId: string,
  endpoint: string,
  input: { attemptCount: number; failureCode: PushFailureCode; error?: string | null },
  now: Date = new Date(),
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("push_delivery_attempts")
    .update({
      status: "dead",
      attempt_count: input.attemptCount,
      failure_code: input.failureCode,
      last_error: input.error ?? null,
      last_attempt_at: now.toISOString(),
    })
    .eq("notification_id", notificationId)
    .eq("endpoint", endpoint);
  if (error) throw new Error(`push delivery dead: ${error.message}`);
}

/** 死信列表，供运维查看与人工排查 */
export async function listDeadLetterPushDeliveries(limit = 100): Promise<PushDeliveryAttempt[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("push_delivery_attempts")
    .select("*")
    .eq("status", "dead")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`push delivery dead list: ${error.message}`);
  return (data ?? []) as PushDeliveryAttempt[];
}

/** 待重试队列总数（同一过滤口径，不含 limit）：积压告警与看板用 */
export async function countPendingPushDeliveries(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("push_delivery_attempts")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw new Error(`push delivery pending count: ${error.message}`);
  return count ?? 0;
}

/** 死信总数：运维看板与告警用 */
export async function countDeadLetterPushDeliveries(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("push_delivery_attempts")
    .select("id", { count: "exact", head: true })
    .eq("status", "dead");
  if (error) throw new Error(`push delivery dead count: ${error.message}`);
  return count ?? 0;
}

/** 失效端点统计：因 push service 404/410 或订阅记录丢失而进入死信的端点数 */
export async function countInvalidPushEndpoints(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("push_delivery_attempts")
    .select("id", { count: "exact", head: true })
    .eq("status", "dead")
    .in("failure_code", [...INVALID_PUSH_ENDPOINT_CODES]);
  if (error) throw new Error(`push delivery invalid endpoint count: ${error.message}`);
  return count ?? 0;
}

export interface PushPruneResult {
  /** 本轮删除的 sent 行数 */
  sent: number;
  /** 本轮删除的 dead 行数 */
  dead: number;
}

/**
 * 清理单个终态的历史行：先按时间升序选出有界 id 列表，再按 id 删除。
 * 先选后删保证单轮工作量有上限（`PUSH_PRUNE_BATCH_LIMIT`），不会因历史积压长时间持锁。
 */
async function pruneTerminalRows(
  status: "sent" | "dead",
  timeColumn: "sent_at" | "last_attempt_at",
  cutoff: string,
  limit: number,
): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("push_delivery_attempts")
    .select("id")
    .eq("status", status)
    .lt(timeColumn, cutoff)
    .order(timeColumn, { ascending: true })
    .limit(limit);
  if (error) throw new Error(`push delivery prune select (${status}): ${error.message}`);
  const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (ids.length === 0) return 0;

  const { count: deleted, error: deleteError } = await admin
    .from("push_delivery_attempts")
    .delete({ count: "exact" })
    .eq("status", status)
    .lt(timeColumn, cutoff)
    .in("id", ids);
  if (deleteError) throw new Error(`push delivery prune delete (${status}): ${deleteError.message}`);
  return deleted ?? ids.length;
}

/**
 * 队列保留策略：删除超过保留期的终态行（sent 7 天、dead 30 天）。
 * 只处理终态，绝不删除 pending，因此不会丢失待投递工作；幂等，可重复执行。
 */
export async function prunePushDeliveryAttempts(
  now: Date = new Date(),
  limit: number = PUSH_PRUNE_BATCH_LIMIT,
): Promise<PushPruneResult> {
  const sentCutoff = new Date(now.getTime() - PUSH_SENT_RETENTION_DAYS * 86_400_000).toISOString();
  const deadCutoff = new Date(now.getTime() - PUSH_DEAD_RETENTION_DAYS * 86_400_000).toISOString();
  const sent = await pruneTerminalRows("sent", "sent_at", sentCutoff, limit);
  const dead = await pruneTerminalRows("dead", "last_attempt_at", deadCutoff, limit);
  return { sent, dead };
}
