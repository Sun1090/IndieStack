/**
 * 管理后台服务端操作
 * 使用 service_role 客户端读取平台数据，避免普通客户端被 RLS 过滤
 */
"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardFailureKey, safelyRequireRole } from "@/lib/auth/guards";
import { ROUTES } from "@/lib/constants";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";
import { listAllAuditLogs } from "@/lib/repositories/audit-logs";
import { listAdminUsersPage as fetchAdminUsersPage } from "@/lib/repositories/admin-users";
import { notifyUser } from "@/lib/email-notify";
import { logActionError } from "@/lib/api-log";
import { updateUserRoleSchema } from "@/lib/validations/admin";

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
    return fail(guardFailureKey(auth.error));
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("id, email, full_name, role, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      await logActionError("[admin] 数据库操作失败", error);
      return fail("databaseError");
    }

    return ok((data ?? []).map((row) => toAdminUser(row as unknown as Record<string, unknown>)));
  } catch (error) {
    await logActionError("[admin] 数据库操作失败", error);
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
    return fail(guardFailureKey(auth.error));
  }

  try {
    const { users, total } = await fetchAdminUsersPage(page, pageSize);
    return ok({ users, total });
  } catch (error) {
    await logActionError("[admin] 数据库操作失败", error);
    return fail("databaseError");
  }
}

/**
 * 改账户角色（仅 `ASSIGNABLE_USER_ROLES` 里的三个值）。
 *
 * **`role` 的类型是 `string` 而不是联合类型**：这个函数的参数在真实调用路径上是
 * 一次 Server Action POST 的反序列化结果，联合类型只活在编译期、那一刻已经不存在。
 * 此前签名写着 `"member" | "admin" | "viewer"`，看上去像是受限的，于是**没有人**
 * 在服务端再校验一次——而 `ASSIGNABLE_USER_ROLES`（注释明写「刻意不含 super_admin」）
 * 当时只被下拉菜单用来渲染选项。把 `role` 传成 `"super_admin"` 就能穿过
 * 「我是 admin ✓ / 目标不是 super_admin ✓」两道判定，把自己（或同伙）写成 super_admin。
 * 现在签名如实写成 `string`，校验落在 `updateUserRoleSchema` 上（运行时枚举 + 白名单）。
 */
export async function updateUserRole(userId: string, role: string): Promise<ActionResult> {
  const auth = await safelyRequireRole("admin");
  if (!auth.success) {
    return fail(guardFailureKey(auth.error));
  }

  // 校验放在鉴权之后：未登录的调用方不该从错误码里读出「哪些取值合法」。
  const parsed = updateUserRoleSchema.safeParse({ userId, role });
  if (!parsed.success) {
    return fail("invalidRole");
  }

  try {
    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (targetError) {
      // 专门的错误键，而不是复用 `databaseError`：管理员看到的「数据库操作失败」既没说明
      // 坏了什么，也没说明这是可重试的。落下去更糟——`!target` 会回答「这个用户不存在」，
      // 把一次读取失败说成一条关于用户的事实。
      await logActionError("[admin] 目标账户角色读取失败", targetError);
      return fail("roleReadFailedAdmin");
    }

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
      await logActionError("[admin] 数据库操作失败", error);
      return fail("databaseError");
    }

    // 通知目标用户（失败不阻断角色更新）
    try {
      await notifyUser({
        userId,
        type: "role_changed",
        title: "账户角色已变更",
        body: `你的平台角色已更新为 ${role}。`,
        link: ROUTES.dashboard,
        metadata: { role },
      });
    } catch (notifyError) {
      await logActionError("[admin] 角色变更通知写入失败", notifyError);
    }

    revalidatePath(ROUTES.adminUsers);
    return ok();
  } catch (error) {
    await logActionError("[admin] 数据库操作失败", error);
    return fail("databaseError");
  }
}

export async function listAuditLogs(): Promise<
  ActionResult<AuditLogRecord[]>
> {
  const auth = await safelyRequireRole("super_admin");
  if (!auth.success) {
    return fail(guardFailureKey(auth.error));
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
    await logActionError("[admin] 数据库操作失败", error);
    return fail("databaseError");
  }
}
