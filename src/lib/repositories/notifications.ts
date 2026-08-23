/**
 * Notifications 数据访问层
 * 收口 notifications 表查询与状态更新。
 */
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type Notification = Database["public"]["Tables"]["notifications"]["Row"];

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
