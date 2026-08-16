/**
 * 管理后台服务端操作
 * 使用 service_role 客户端读取平台数据，避免普通客户端被 RLS 过滤
 */
"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { safelyRequireRole } from "@/lib/auth/guards";
import { ROUTES } from "@/lib/constants";

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
  { success: true; data: AdminUser[] } | { success: false; error: string }
> {
  const auth = await safelyRequireRole("admin");
  if (!auth.success) {
    return {
      success: false,
      error: auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden",
    };
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("id, email, full_name, role, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[admin] 数据库操作失败:", error);
      return { success: false, error: "databaseError" };
    }

    return {
      success: true,
      data: (data ?? []).map((row) => toAdminUser(row as unknown as Record<string, unknown>)),
    };
  } catch (error) {
    console.error("[admin] 操作失败:", error);
    return { success: false, error: "internalError" };
  }
}

export async function updateUserRole(
  userId: string,
  role: "member" | "admin" | "viewer",
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = await safelyRequireRole("admin");
  if (!auth.success) {
    return {
      success: false,
      error: auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden",
    };
  }

  try {
    const admin = createAdminClient();
    const { data: target } = (await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle()) as { data: { role: string } | null };

    if (!target) {
      return { success: false, error: "userNotFoundAdmin" };
    }

    if (target.role === "super_admin" && auth.data.role !== "super_admin") {
      return { success: false, error: "superAdminOnly" };
    }

    const { error } = await admin
      .from("profiles")
      .update({ role, updated_at: new Date().toISOString() })
      .eq("id", userId);

    if (error) {
      console.error("[admin] 数据库操作失败:", error);
      return { success: false, error: "databaseError" };
    }

    revalidatePath(ROUTES.adminUsers);
    return { success: true };
  } catch (error) {
    console.error("[admin] 操作失败:", error);
    return { success: false, error: "internalError" };
  }
}

export async function listAuditLogs(): Promise<
  { success: true; data: AuditLogRecord[] } | { success: false; error: string }
> {
  const auth = await safelyRequireRole("super_admin");
  if (!auth.success) {
    return {
      success: false,
      error: auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden",
    };
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("[admin] 数据库操作失败:", error);
      return { success: false, error: "databaseError" };
    }

    return {
      success: true,
      data: (data ?? []).map((row) => ({
        id: Number(row.id),
        user_id: row.user_id,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
        created_at: row.created_at,
      })),
    };
  } catch (error) {
    console.error("[admin] 操作失败:", error);
    return { success: false, error: "internalError" };
  }
}
