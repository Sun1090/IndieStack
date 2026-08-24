/**
 * Webhook 事件日志查询（admin 专用）
 * 数据访问经 repositories/webhook-events（service_role，RLS 拒绝普通访问）
 */
"use server";

import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";
import { listRecentWebhookEvents } from "@/lib/repositories/webhook-events";

export type WebhookEventRecord = {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  status: string;
  error_message: string | null;
  created_at: string;
  payload?: Record<string, unknown>;
};

export async function listWebhookEvents(
  limit = 50,
): Promise<ActionResult<WebhookEventRecord[]>> {
  try {
    return ok((await listRecentWebhookEvents(limit)) as WebhookEventRecord[]);
  } catch (error) {
    console.error("[listWebhookEvents] 查询失败:", error);
    return fail("databaseError");
  }
}
