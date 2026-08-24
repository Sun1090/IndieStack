/**
 * 管理后台服务端操作
 * 使用 service_role 客户端读取平台数据，避免普通客户端被 RLS 过滤
 */
"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { safelyRequireRole } from "@/lib/auth/guards";
import { ROUTES } from "@/lib/constants";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";
import { listAllAuditLogs } from "@/lib/repositories/audit-logs";
import { listAdminUsersPage as fetchAdminUsersPage } from "@/lib/repositories/admin-users";

export type AdminUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  created_at: string;
};

export type AuditLogRecord = {
  id: number;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

function toAdminUser(row: Record<string, unknown>): AdminUser {
  return {
    id: String(row.id),
    email: row.email ? String(row.email) : null,
    full_name: row.full_name ? String(row.full_name) : null,
    role: String(row.role ?? "member"),
    created_at: String(row.created_at ?? ""),
  };
}

export async function listAdminUsers(): Promise<
  ActionResult<AdminUser[]>
> {
  const auth = await safelyRequireRole("admin");
  if (!auth.success) {
    return fail(auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden");
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("id, email, full_name, role, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[admin] 数据库操作失败:", error);
      return fail("databaseError");
    }

    return ok((data ?? []).map((row) => toAdminUser(row as unknown as Record<string, unknown>)));
  } catch (error) {
    console.error("[admin] 数据库操作失败:", error);
    return fail("databaseError");
  }
}


/** 用户分页列表（服务端分页，避免大表全量拉取） */
export async function listAdminUsersPage(
  page = 1,
  pageSize = 20,
): Promise<ActionResult<{ users: AdminUser[]; total: number }>> {
  const auth = await safelyRequireRole("admin");
  if (!auth.success) {
    return fail(auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden");
  }

  try {
    const { users, total } = await fetchAdminUsersPage(page, pageSize);
    return ok({ users, total });
  } catch (error) {
    console.error("[admin] 数据库操作失败:", error);
    return fail("databaseError");
  }
}

export async function updateUserRole(
  userId: string,
  role: "member" | "admin" | "viewer",
): Promise<ActionResult> {
  const auth = await safelyRequireRole("admin");
  if (!auth.success) {
    return fail(auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden");
  }

  try {
    const admin = createAdminClient();
    const { data: target } = (await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle()) as { data: { role: string } | null };

    if (!target) {
      return fail("userNotFoundAdmin");
    }

    if (target.role === "super_admin" && auth.data.role !== "super_admin") {
      return fail("superAdminOnly");
    }

    const { error } = await admin
      .from("profiles")
      .update({ role, updated_at: new Date().toISOString() })
      .eq("id", userId);

    if (error) {
      console.error("[admin] 数据库操作失败:", error);
      return fail("databaseError");
    }

    revalidatePath(ROUTES.adminUsers);
    return ok();
  } catch (error) {
    console.error("[admin] 数据库操作失败:", error);
    return fail("databaseError");
  }
}

export async function listAuditLogs(): Promise<
  ActionResult<AuditLogRecord[]>
> {
  const auth = await safelyRequireRole("super_admin");
  if (!auth.success) {
    return fail(auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden");
  }

  try {
    const rows = await listAllAuditLogs();

    const data: AuditLogRecord[] = rows.map((row) => ({
      id: Number(row.id),
      user_id: (row.user_id as string) ?? null,
      action: String(row.action ?? ""),
      entity_type: String(row.entity_type ?? ""),
      entity_id: (row.entity_id as string) ?? null,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      created_at: String(row.created_at ?? ""),
    }));
    return ok(data);
  } catch (error) {
    console.error("[admin] 数据库操作失败:", error);
    return fail("databaseError");
  }
}
