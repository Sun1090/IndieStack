/**
 * ContactMessages 数据访问层（service_role）
 * contact_messages 表 RLS 仅放行匿名 INSERT，读取须 admin 客户端。
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type ContactMessageRow = Record<string, unknown>;

/** 最近联系消息列表（倒序），含分页 */
export async function listRecentContactMessages(
  limit = 50,
): Promise<ContactMessageRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contact_messages")
    .select("id, name, email, subject, message, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ContactMessageRow[];
}

/** 消息总数 */
export async function countContactMessages(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("contact_messages")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}
