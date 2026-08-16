/**
 * 独立开发技术栈 路由守卫 & 权限检查
 * ======================
 *
 * 服务端函数，用于 Server Components、Route Handlers、Server Actions 中
 * 进行角色和权限校验，组合了 Supabase 会话认证。
 *
 * 使用方式（Server Component）：
 *   import { requireAuth, requireRole, requirePermission } from "@/lib/auth/guards"
 *   const user = await requireAuth()           // 未登录 => 抛出 UNAUTHORIZED
 *   await requireRole("admin")                 // 无 admin 角色 => 抛出 FORBIDDEN
 *   await requirePermission("team:invite")     // 无此权限 => 抛出 FORBIDDEN
 *
 * 使用方式（API Route / Server Action）：
 *   const result = await safelyRequireAuth()
 *   if (!result.success) return result.error
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { hasPermission, parseRole, type Role } from "./roles";
import type { Permission } from "./permissions";

// ============================================================
// 守卫错误类型
// ============================================================

export class AuthGuardError extends Error {
  constructor(
    message: string,
    public code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND",
  ) {
    super(message);
    this.name = "AuthGuardError";
  }
}

export const UNAUTHORIZED = new AuthGuardError("请先登录后再访问此页面", "UNAUTHORIZED");

export const FORBIDDEN = new AuthGuardError("您没有足够的权限访问此页面", "FORBIDDEN");

// ============================================================
// 守卫函数
// ============================================================

export type AuthUser = {
  id: string;
  email: string | undefined;
  role: Role;
};

/**
 * 获取当前认证用户信息和角色
 * 未登录时重定向到登录页（Server Component 使用）
 */
export async function requireAuth(): Promise<AuthUser> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(ROUTES.login);
  }

  // 从 profiles 表中获取角色
  const { data: profile } = (await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()) as { data: { role: string } | null };

  const role = parseRole(profile?.role as string | undefined) ?? "member";

  return {
    id: user.id,
    email: user.email ?? undefined,
    role,
  };
}

/**
 * 要求用户具备指定角色（或更高等级角色）
 */
export async function requireRole(minRole: Role): Promise<AuthUser> {
  const authUser = await requireAuth();

  const roleLevels: Record<Role, number> = {
    super_admin: 100,
    admin: 80,
    member: 50,
    viewer: 10,
  };

  if ((roleLevels[authUser.role] ?? 0) < (roleLevels[minRole] ?? 0)) {
    throw FORBIDDEN;
  }

  return authUser;
}

/**
 * 要求用户具备指定权限
 */
export async function requirePermission(permission: Permission): Promise<AuthUser> {
  const authUser = await requireAuth();

  if (!hasPermission(authUser.role, permission)) {
    throw FORBIDDEN;
  }

  return authUser;
}

// ============================================================
// 安全版本（不抛异常，不 redirect，用于 API Route / Server Action）
// ============================================================

export type GuardResult<T> = { success: true; data: T } | { success: false; error: AuthGuardError };

/**
 * 安全获取认证用户（API Route 使用）
 */
export async function safelyRequireAuth(): Promise<GuardResult<AuthUser>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: UNAUTHORIZED };
    }

    const { data: profile } = (await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()) as { data: { role: string } | null };

    const role = parseRole(profile?.role as string | undefined) ?? "member";

    return {
      success: true,
      data: { id: user.id, email: user.email ?? undefined, role },
    };
  } catch {
    return { success: false, error: UNAUTHORIZED };
  }
}

/**
 * 安全要求权限（API Route 使用）
 */
export async function safelyRequirePermission(
  permission: Permission,
): Promise<GuardResult<AuthUser>> {
  const result = await safelyRequireAuth();
  if (!result.success) return result;

  if (!hasPermission(result.data.role, permission)) {
    return { success: false, error: FORBIDDEN };
  }

  return result;
}

/**
 * 安全要求角色（API Route 使用）
 */
export async function safelyRequireRole(minRole: Role): Promise<GuardResult<AuthUser>> {
  const result = await safelyRequireAuth();
  if (!result.success) return result;

  const roleLevels: Record<Role, number> = {
    super_admin: 100,
    admin: 80,
    member: 50,
    viewer: 10,
  };

  if ((roleLevels[result.data.role] ?? 0) < (roleLevels[minRole] ?? 0)) {
    return { success: false, error: FORBIDDEN };
  }

  return result;
}

/**
 * 将守卫失败错误映射为 HTTP 状态码（API Route 使用）
 * 未登录 → 401 Unauthorized；已登录但无权限 → 403 Forbidden
 */
export function guardHttpStatus(error: AuthGuardError): 401 | 403 {
  return error.code === "UNAUTHORIZED" ? 401 : 403;
}
