/**
 * WebhookEvents 数据访问层（service_role）
 * webhook_events 表 RLS 拒绝普通访问，仅 admin 客户端可读写。
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type WebhookEventRow = Record<string, unknown>;

/** 记录 webhook 事件（幂等：event_id 冲突时更新） */
export async function upsertWebhookEvent(row: {
  provider: string;
  event_id: string;
  event_type: string;
  status: string;
  error_message?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("webhook_events").upsert(
     
    { ...row, payload: (row.payload ?? {}) as any },
    { onConflict: "event_id" },
  );
  if (error) throw new Error(error.message);
}

/** 最近事件列表（倒序） */
export async function listRecentWebhookEvents(limit = 50): Promise<WebhookEventRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("webhook_events")
    .select("id, provider, event_id, event_type, status, error_message, payload, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as WebhookEventRow[];
}
