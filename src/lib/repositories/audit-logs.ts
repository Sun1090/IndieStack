/**
 * AuditLogs 数据访问层（service_role）
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type AuditInsert = Database["public"]["Tables"]["audit_logs"]["Insert"];

export type AuditLogRow = Record<string, unknown>;

export interface Paginated<T> {
  rows: T[];
  /** 精确总数；默认不请求（null），见 `withExactTotal`。 */
  total: number | null;
}

export interface AuditLogPageOptions {
  /**
   * 是否请求精确 `total`。默认 **false**。
   *
   * PostgREST 的 `count: "exact"` 会追加一次 `count(*)`，而 `audit_logs` 是永久保留、
   * 只追加的表（[retention.md](../../../docs/db/retention.md)），该计数是这套查询里唯一
   * 随表无限增长的开销：本地 20 万行实测为 Parallel Seq Scan 12.99ms / 6956 buffers，
   * 而分页本身（`order by created_at desc limit 50`）走 `idx_audit_logs_created_at`
   * 只需 0.082ms / 53 buffers。当前没有调用方读取 `total`，因此默认关闭。
   * 若确实需要总量，优先用 `count: "planned"`（`pg_class.reltuples` 估算，近零成本）。
   */
  withExactTotal?: boolean;
}

/** 审计日志分页查询（倒序，服务端分页避免大表全量拉取） */
export async function listAuditLogsPage(
  page = 1,
  pageSize = 50,
  options: AuditLogPageOptions = {},
): Promise<Paginated<AuditLogRow>> {
  const admin = createAdminClient();
  const from = (page - 1) * pageSize;
  const { data, error, count } = await admin
    .from("audit_logs")
    .select("*", options.withExactTotal ? { count: "exact" } : {})
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as AuditLogRow[], total: options.withExactTotal ? (count ?? 0) : null };
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
