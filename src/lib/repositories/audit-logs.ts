/**
 * AuditLogs 数据访问层（service_role）
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type AuditLogRow = Record<string, unknown>;

/** 全量审计日志（倒序，上限 500） */
export async function listAllAuditLogs(): Promise<AuditLogRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditLogRow[];
}
