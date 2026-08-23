/**
 * Webhook 事件日志查询（admin 专用）
 * 数据来源：supabase/migrations/010_webhook_events.sql 创建的 webhook_events 表
 */
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";

export type WebhookEventRecord = {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  status: string;
  error_message: string | null;
  created_at: string;
};

/** 最近 N 条 webhook 事件（倒序）。仅 super_admin 可进入页面；RLS 拒绝普通访问，此处走 service_role。 */
export async function listWebhookEvents(
  limit = 50,
): Promise<ActionResult<WebhookEventRecord[]>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("webhook_events")
    .select("id, provider, event_id, event_type, status, error_message, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  if (error) {
    console.error("[listWebhookEvents] 查询失败:", error.message);
    return fail("databaseError");
  }
  return ok((data ?? []) as WebhookEventRecord[]);
}
