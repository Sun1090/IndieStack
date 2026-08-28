/**
 * Webhook 事件日志查询（admin 专用）
 * 数据访问经 repositories/webhook-events（service_role，RLS 拒绝普通访问）
 */
"use server";

import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";
import { listRecentWebhookEvents } from "@/lib/repositories/webhook-events";
import { safelyRequireRole } from "@/lib/auth/guards";

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

/**
 * 列出近期 Webhook 事件日志（仅 admin/super_admin）。
 * 页面层虽已有 requireRole 守卫，Server Action 本身亦需校验，
 * 防止通过直接调用 Action 绕过页面入口越权读取。
 */
export async function listWebhookEvents(
  limit = 50,
): Promise<ActionResult<WebhookEventRecord[]>> {
  const auth = await safelyRequireRole("admin");
  if (!auth.success) {
    return fail(auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden");
  }

  try {
    return ok((await listRecentWebhookEvents(limit)) as WebhookEventRecord[]);
  } catch (error) {
    console.error("[listWebhookEvents] 查询失败:", error);
    return fail("databaseError");
  }
}
