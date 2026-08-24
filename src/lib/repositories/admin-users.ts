/**
 * AdminUsers 数据访问层（service_role，仅平台 admin 可达）
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminUser } from "@/lib/actions/admin";

export interface PaginatedUsers {
  users: AdminUser[];
  total: number;
}

/** 用户分页列表（倒序） */
export async function listAdminUsersPage(
  page = 1,
  pageSize = 20,
): Promise<PaginatedUsers> {
  const admin = createAdminClient();
  const from = (page - 1) * pageSize;
  const { data, error, count } = await admin
    .from("profiles")
    .select("id, email, full_name, role, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw new Error(error.message);

  return {
    users: (data ?? []).map(
      (row) =>
        ({
          id: row.id,
          email: row.email,
          full_name: row.full_name,
          role: row.role,
          created_at: row.created_at,
        }) as AdminUser,
    ),
    total: count ?? 0,
  };
}
