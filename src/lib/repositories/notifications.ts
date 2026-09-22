/**
 * Notifications 数据访问层
 * 收口 notifications 表查询与状态更新。
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export type Notification = Database["public"]["Tables"]["notifications"]["Row"];

/**
 * 通知类型定义在 `@/lib/notifications/types`（无依赖模块，mock 层与 i18n 门禁也要用，
 * 而本模块导入时会初始化 Supabase 客户端）。这里原样再导出，保持既有 import 路径不变。
 */
export { NOTIFICATION_TYPES } from "@/lib/notifications/types";
export type { NotificationType } from "@/lib/notifications/types";
import { NOTIFICATION_TYPES } from "@/lib/notifications/types";
import type { NotificationType } from "@/lib/notifications/types";

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string | null;
  metadata?: Record<string, unknown>;
  /** Stable event key; retries return the existing notification id. */
  idempotencyKey?: string;
}

/** 邮件失败重试上限：达到后进入死信，不再被 worker 拉取 */
export const EMAIL_MAX_ATTEMPTS = 3;

/** 进入邮件队列的通知类型：拉取与积压计数共用，避免指标口径漂移。 */
export const EMAIL_NOTIFICATION_TYPES = [
  "team_invite",
  "role_changed",
  "payment_succeeded",
  "security_alert",
] as const satisfies readonly NotificationType[];

/**
 * 「待发队列」= 未标记已发送 + 未读 + 限定类型 + 未达死信门槛。
 *
 * 三个消费方（worker 拉取、积压计数、最老一条的年龄）必须整段一致，否则面板上报的年龄
 * 说的就不是 worker 看到的那支队伍。Supabase 的查询链是逐列泛型的（`select("*")` 与
 * `select("id", {head:true})` 返回不同类型），抽成一个共享函数会把类型压成第一张表，
 * 所以这里只把最易漂移的死信条件收成常量，四段过滤各自写全，
 * 一致性由 `notifications.test.ts` 的「同一段过滤」用例钉住。
 */
const EMAIL_DEAD_LETTER_FILTER = `metadata->>email_attempts.is.null,metadata->>email_attempts.lt.${EMAIL_MAX_ATTEMPTS}`;

/**
 * 待发邮件通知（未读 + 未标记已发送 + 限定类型），供邮件 worker 拉取。
 * 邮件失败重试计数（metadata.email_attempts）达到上限的死信不再进入队列（v0.5.0 A02）。
 */
export async function listUnsentEmailNotifications(
  types: readonly NotificationType[] = EMAIL_NOTIFICATION_TYPES,
  limit = 100,
): Promise<Notification[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notifications")
    .select("*")
    .eq("email_sent", false)
    .eq("is_read", false)
    .in("type", [...types])
    .or(EMAIL_DEAD_LETTER_FILTER)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as Notification[];
}

/** 队列积压告警阈值（C03）：待发通知超过该数量时 Sentry 上报 */
export const EMAIL_BACKLOG_ALERT_THRESHOLD = 500;

/** 待发通知总数（同一过滤口径，不含 limit）：积压告警与看板用（C03） */
export async function countUnsentEmailNotifications(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("email_sent", false)
    .eq("is_read", false)
    .in("type", [...EMAIL_NOTIFICATION_TYPES])
    .or(EMAIL_DEAD_LETTER_FILTER);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * 最老一条待发通知的 `created_at`（A05 可观测）；队列为空时 null。
 * 与 worker 拉取同序（`created_at` 升序），所以第一条就是「卡在队列头部最久」的那一条。
 */
export async function oldestUnsentEmailCreatedAt(): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notifications")
    .select("created_at")
    .eq("email_sent", false)
    .eq("is_read", false)
    .in("type", [...EMAIL_NOTIFICATION_TYPES])
    .or(EMAIL_DEAD_LETTER_FILTER)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { created_at?: string }[];
  return rows[0]?.created_at ?? null;
}

/** 已达到重试上限的死信通知，供运维查看与人工恢复。 */
export async function listDeadLetterNotifications(limit = 100): Promise<Notification[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notifications")
    .select("*")
    .eq("email_sent", false)
    .eq("is_read", false)
    .or(`metadata->>email_attempts.gte.${EMAIL_MAX_ATTEMPTS}`)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as Notification[];
}

/** 按 id 批量读取通知（service_role），供 push 重试 worker 取回投递内容 */
export async function listNotificationsByIds(ids: string[]): Promise<Notification[]> {
  if (ids.length === 0) return [];
  const admin = createAdminClient();
  const { data, error } = await admin.from("notifications").select("*").in("id", ids);
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
    .update({
      metadata: JSON.parse(
        JSON.stringify(metadata),
      ) as Database["public"]["Tables"]["notifications"]["Update"]["metadata"],
    })
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
      metadata: JSON.parse(
        JSON.stringify(input.metadata ?? {}),
      ) as Database["public"]["Tables"]["notifications"]["Insert"]["metadata"],
      ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
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
export async function listRecentNotifications(userId: string, limit = 10): Promise<Notification[]> {
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

/**
 * 未读通知数（命中 idx_notifications_unread 部分索引）。
 * 查询失败抛错：把一次数据库故障读成「0 条未读」，会让侧边栏角标和「全部已读」按钮一起消失，
 * 而用户没有任何线索知道刚刚那次没读成。
 */
export async function countUnreadNotifications(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * 批量标记已读；返回更新的行数。
 * 失败抛错（调用方回 `databaseError`）：这条链上「返回 0」既可能是真的没有未读，
 * 也可能是**一条都没改成**，混在一起就等于对用户宣布成功。
 */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false)
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** 标记单条通知已读（RLS 限定本人） */
export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
