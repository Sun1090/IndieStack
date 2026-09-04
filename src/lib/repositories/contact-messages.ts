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

export interface ContactMessageFilter {
  status?: MessageStatus | "all";
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedMessages {
  rows: ContactMessageRow[];
  total: number;
}

/** 转义 PostgREST like 通配符与 or 分隔符（防注入式破坏查询结构） */
export function escapeLike(input: string): string {
  return input.replace(/[\\%,]/g, (c) => `\\${c}`).replace(/_/g, "\\_").slice(0, 100);
}

/**
 * 联系消息分页查询（倒序）：状态筛选 + 姓名/邮箱/主题模糊搜 + 服务端分页。
 */
export async function listContactMessagesPage(
  filter: ContactMessageFilter = {},
): Promise<PaginatedMessages> {
  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(filter.pageSize ?? 20)));
  const from = (page - 1) * pageSize;

  const admin = createAdminClient();
  // 条件过滤需重赋值，supabase 链式泛型不支持，收敛为最小结构类型
  interface FilterChain {
    eq: (column: string, value: unknown) => FilterChain;
    or: (filters: string) => FilterChain;
    order: (column: string, options?: { ascending?: boolean }) => FilterChain;
    range: (
      from: number,
      to: number,
    ) => Promise<{ data: unknown; error: { message: string } | null; count: number | null }>;
  }
  let query = admin
    .from("contact_messages")
    .select("id, name, email, subject, message, status, created_at", { count: "exact" }) as unknown as FilterChain;

  if (filter.status && filter.status !== "all") {
    if (!["new", "in_progress", "resolved"].includes(filter.status)) {
      throw new Error(`invalid_status:${filter.status}`);
    }
    query = query.eq("status", filter.status);
  }

  const keyword = filter.search?.trim();
  if (keyword) {
    const q = escapeLike(keyword);
    query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,subject.ilike.%${q}%`);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as ContactMessageRow[], total: count ?? 0 };
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
