/**
 * Notifications 数据访问层
 * 收口 notifications 表查询与状态更新。
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export type Notification = Database["public"]["Tables"]["notifications"]["Row"];

/** 通知类型（seed 既有 + v0.4.0 新增；展示映射见通知页 badgeVariant） */
export const NOTIFICATION_TYPES = [
  "system",
  "team_invite",
  "role_changed",
  "payment_succeeded",
  "billing_update",
  "deployment",
  "security_alert",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * 创建通知（service_role）。
 * RLS 仅允许用户自插，他人触发（邀请/改角色/支付）必须走 admin 客户端；
 * 仅受信服务端上下文调用，失败由调用方吞错（不阻断主流程）。
 */
export async function createNotification(input: NewNotification): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    metadata: JSON.parse(JSON.stringify(input.metadata ?? {})) as Database["public"]["Tables"]["notifications"]["Insert"]["metadata"],
  });
  if (error) throw new Error(error.message);
}

/** 最近通知列表（登录态，RLS 隔离） */
export async function listRecentNotifications(
  userId: string,
  limit = 10,
): Promise<Notification[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as Notification[]) ?? [];
}

/** 批量标记已读；返回更新的行数 */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false)
    .select("id");
  return data?.length ?? 0;
}

/** 标记单条通知已读（RLS 限定本人） */
export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
