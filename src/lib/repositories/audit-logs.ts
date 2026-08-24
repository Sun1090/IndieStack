/**
 * AuditLogs 数据访问层（service_role）
 */
import { createAdminClient } from "@/lib/supabase/admin";

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
