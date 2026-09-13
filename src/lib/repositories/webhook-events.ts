/**
 * WebhookEvents 数据访问层（service_role）
 * webhook_events 表 RLS 拒绝普通访问，仅 admin 客户端可读写。
 *
 * 幂等写入协议（见 supabase/migrations/030_webhook_event_idempotency.sql）：
 *   claimWebhookEvent() → 执行副作用 → finalizeWebhookEvent()
 * Stripe 至少投递一次且会对非 2xx 主动重试，因此只有 claimed 的投递才允许执行副作用；
 * duplicate 必须直接回 200，让 Stripe 停止重试而不是重放副作用。
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type WebhookEventRow = Record<string, unknown>;

/** 幂等占位结果：claimed=本次投递获得处理权，duplicate=应跳过副作用 */
export type WebhookClaimOutcome = "claimed" | "duplicate";

export interface WebhookClaim {
  outcome: WebhookClaimOutcome;
  /** 该事件累计占位次数（首次为 1），用于观测 Stripe 重试次数 */
  attempts: number;
}

/** 事件处理状态；failed 允许下一次投递重新占位，received 超过租约同样可回收 */
export type WebhookEventStatus = "received" | "processed" | "skipped" | "failed";

/**
 * 原子占位（RPC `claim_webhook_event`）。
 *
 * 首次投递返回 claimed 并插入 received 行；重复投递返回 duplicate；
 * 上一次失败或占位租约超时（进程崩溃）时允许重新占位并累加 attempts。
 *
 * RPC 报错时**抛出**而不是降级为 duplicate：数据库故障被伪装成"已处理"会让
 * Stripe 收到 200 后停止重试，静默丢失支付状态同步。
 */
export async function claimWebhookEvent(row: {
  provider: string;
  event_id: string;
  event_type: string;
}): Promise<WebhookClaim> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_webhook_event", {
    p_provider: row.provider,
    p_event_id: row.event_id,
    p_event_type: row.event_type,
  });
  if (error) throw new Error(error.message);

  // `returns table` 经 PostgREST 返回行数组（mock 客户端返回同样形状）
  const result = (Array.isArray(data) ? data[0] : data) as
    | { outcome?: string; attempts?: number }
    | null
    | undefined;
  if (!result || (result.outcome !== "claimed" && result.outcome !== "duplicate")) {
    // 拿不到明确的占位结论时宁可让 Stripe 重试，也不要当作已处理
    throw new Error(`claim_webhook_event 返回了意外的结果: ${String(result?.outcome)}`);
  }

  return { outcome: result.outcome, attempts: result.attempts ?? 0 };
}

/**
 * 落定事件处理结果。
 * processed/skipped 会被后续重复投递视为 duplicate；
 * failed 允许 Stripe 的下一次重试重新占位（attempts 累加）并重跑副作用。
 */
export async function finalizeWebhookEvent(row: {
  provider: string;
  event_id: string;
  status: Exclude<WebhookEventStatus, "received">;
  error_message?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("webhook_events")
    .update({
      status: row.status,
      error_message: row.error_message ?? null,
      last_attempt_at: new Date().toISOString(),
    })
    .eq("provider", row.provider)
    .eq("event_id", row.event_id);
  if (error) throw new Error(error.message);
}

/** 最近事件列表（倒序） */
export async function listRecentWebhookEvents(limit = 50): Promise<WebhookEventRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("webhook_events")
    .select(
      "id, provider, event_id, event_type, status, attempts, error_message, payload, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as WebhookEventRow[];
}

/** 事件总数 */
export async function countWebhookEvents(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("webhook_events")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}
