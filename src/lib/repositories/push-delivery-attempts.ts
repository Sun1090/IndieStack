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
  | "timeout"
  | "network"
  | string;

/** 重试上限（含首次即时投递）：达到后进入死信，不再被 worker 拉取（与邮件一致） */
export const PUSH_MAX_ATTEMPTS = 3;

/** 退避基数：首次失败 60s 后重试，其后指数翻倍 */
export const PUSH_BACKOFF_BASE_MS = 60_000;

/** 退避上限，避免长任务被推到过远 */
export const PUSH_BACKOFF_CAP_MS = 60 * 60_000;

/** 待重试队列积压告警阈值（cron 上报 Sentry） */
export const PUSH_BACKLOG_ALERT_THRESHOLD = 500;

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
