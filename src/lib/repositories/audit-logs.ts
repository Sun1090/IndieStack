/**
 * AuditLogs 数据访问层（service_role）
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type AuditInsert = Database["public"]["Tables"]["audit_logs"]["Insert"];

export type AuditLogRow = Record<string, unknown>;

export interface Paginated<T> {
  rows: T[];
  total: number;
}

/** 审计日志分页查询（倒序，服务端分页避免大表全量拉取） */
export async function listAuditLogsPage(
  page = 1,
  pageSize = 50,
): Promise<Paginated<AuditLogRow>> {
  const admin = createAdminClient();
  const from = (page - 1) * pageSize;
  const { data, error, count } = await admin
    .from("audit_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as AuditLogRow[], total: count ?? 0 };
}

/** 兼容旧调用：首页 100 条 */
export async function listAllAuditLogs(): Promise<AuditLogRow[]> {
  const { rows } = await listAuditLogsPage(1, 100);
  return rows;
}

export interface AuditEvent {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * 追加审计事件（service_role）。
 * 登录类事件不可因 RLS 丢失，且失败登录本就没有会话；调用方 action 负责限频与参数约束。
 */
export async function appendAuditLog(event: AuditEvent): Promise<void> {
  const admin = createAdminClient();
  const row: AuditInsert = {
    user_id: event.userId,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId ?? null,
    metadata: JSON.parse(JSON.stringify(event.metadata ?? {})) as AuditInsert["metadata"],
  };
  const { error } = await admin.from("audit_logs").insert(row);
  if (error) throw new Error(error.message);
}
