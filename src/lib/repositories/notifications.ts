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

/** 邮件失败重试上限：达到后进入死信，不再被 worker 拉取 */
export const EMAIL_MAX_ATTEMPTS = 3;

/**
 * 待发邮件通知（未读 + 未标记已发送 + 限定类型），供邮件 worker 拉取。
 * 邮件失败重试计数（metadata.email_attempts）达到上限的死信不再进入队列（v0.5.0 A02）。
 */
export async function listUnsentEmailNotifications(
  types: NotificationType[] = ["team_invite", "role_changed", "payment_succeeded", "security_alert"],
  limit = 100,
): Promise<Notification[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notifications")
    .select("*")
    .eq("email_sent", false)
    .eq("is_read", false)
    .in("type", types)
    .or(`metadata->>email_attempts.is.null,metadata->>email_attempts.lt.${EMAIL_MAX_ATTEMPTS}`)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as Notification[];
}

/** 标记邮件已发送（worker 回执） */
export async function markEmailSent(notificationId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("notifications")
    .update({ email_sent: true })
    .eq("id", notificationId);
  if (error) throw new Error(error.message);
}

/**
 * 记录一次邮件发送失败（worker 回执）：保留既有 metadata 键，
 * 累加 email_attempts 并记录最近一次错误（email_error），供死信排查。
 * metadata 由调用方基于行内现值构造，避免服务端再读一次。
 */
export async function markEmailFailed(
  notificationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("notifications")
    .update({ metadata: JSON.parse(JSON.stringify(metadata)) as Database["public"]["Tables"]["notifications"]["Update"]["metadata"] })
    .eq("id", notificationId);
  if (error) throw new Error(error.message);
}

/**
 * 创建通知（service_role）。
 * RLS 仅允许用户自插，他人触发（邀请/改角色/支付）必须走 admin 客户端；
 * 仅受信服务端上下文调用，失败由调用方吞错（不阻断主流程）。
 * 返回新建通知 id（供实时邮件回执 email_sent），库未返回时为 null。
 */
export async function createNotification(input: NewNotification): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notifications")
    .insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      metadata: JSON.parse(JSON.stringify(input.metadata ?? {})) as Database["public"]["Tables"]["notifications"]["Insert"]["metadata"],
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * 最近通知列表（登录态，RLS 隔离）。
 * 查询失败抛错（调用方展示错误态），不再吞错回空数组。
 */
export async function listRecentNotifications(
  userId: string,
  limit = 10,
): Promise<Notification[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as Notification[]) ?? [];
}

/** 未读通知数（命中 idx_notifications_unread 部分索引） */
export async function countUnreadNotifications(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  return count ?? 0;
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
