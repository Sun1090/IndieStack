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
    .select("id, name, email, subject, message, status, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ContactMessageRow[];
}

/** 状态流转顺序（仅允许向前） */
const STATUS_ORDER = ["new", "in_progress", "resolved"] as const;

export type MessageStatus = (typeof STATUS_ORDER)[number];

/**
 * 更新处理状态。先读当前态，仅允许向前流转；非法回退抛错。
 */
export async function setMessageStatus(id: string, status: MessageStatus): Promise<void> {
  const admin = createAdminClient();
  const { data: current, error: readError } = await admin
    .from("contact_messages")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const currentStatus = (current as { status?: string } | null)?.status ?? "new";
  const from = STATUS_ORDER.indexOf(currentStatus as MessageStatus);
  const to = STATUS_ORDER.indexOf(status);
  if (to < 0 || from < 0 || to <= from) {
    throw new Error(`invalid_transition:${currentStatus}->${status}`);
  }
  const { error } = await admin.from("contact_messages").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
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
