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
    public code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "SERVICE_UNAVAILABLE",
  ) {
    super(message);
    this.name = "AuthGuardError";
  }
}

export const UNAUTHORIZED = new AuthGuardError("请先登录后再访问此页面", "UNAUTHORIZED");

export const FORBIDDEN = new AuthGuardError("您没有足够的权限访问此页面", "FORBIDDEN");

/**
 * 会话或角色读不出来时会用它。
 *
 * 旧实现在这里把失败的查询按「查不到这一行」处理：`profile` 为 null → 角色降级成 `member`，
 * 于是管理员在一次数据库抖动后被礼貌地请出后台，而日志里什么都不会留下——看起来是权限问题，
 * 其实是「我们没读到」。二者必须分开，因为修法完全不同。
 *
 * 会话读取同理但更要紧：`auth.getUser()` 把失败装在 `error` 里返回（不抛），旧实现连 `error`
 * 都不取，于是 Auth 服务一次抖动被答成「你没登录」——客户端清掉本地会话并跳登录页，而重新登录
 * 走的正是同一条读取，用户除了被登出之外得不到任何新信息。
 */
export const SERVICE_UNAVAILABLE = new AuthGuardError(
  "权限校验暂时不可用，请稍后重试",
  "SERVICE_UNAVAILABLE",
);

/** 读取当前会话用户的角色；`error` 与「没有 profiles 行」在这里是分开的两件事。 */
async function readSessionRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    // maybeSingle：缺行是正常结果（回落 member），只有查询真的失败才需要报错。
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.role ?? null;
}

/** 会话里的用户；只需要这两个字段，故不依赖 AuthUserIdentity 的具体形状。 */
type SessionUser = { id: string; email?: string | null };

/** 读取当前会话用户。`error` 与「确实没有会话」在这里是分开的两件事。 */
async function readSessionUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<SessionUser | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  return data.user ?? null;
}

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

  let session: SessionUser | null;
  try {
    session = await readSessionUser(supabase);
  } catch (error) {
    console.error("[guards] 读取会话失败", error);
    throw SERVICE_UNAVAILABLE;
  }

  if (!session) {
    redirect(ROUTES.login);
  }

  // 从 profiles 表中获取角色
  let rawRole: string | null;
  try {
    rawRole = await readSessionRole(supabase, session.id);
  } catch (error) {
    console.error("[guards] 读取会话角色失败", error);
    throw SERVICE_UNAVAILABLE;
  }

  const role = parseRole(rawRole ?? undefined) ?? "member";

  return {
    id: session.id,
    email: session.email ?? undefined,
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
    const session = await readSessionUser(supabase);

    if (!session) {
      return { success: false, error: UNAUTHORIZED };
    }

    let rawRole: string | null;
    try {
      rawRole = await readSessionRole(supabase, session.id);
    } catch (error) {
      console.error("[guards] 读取会话角色失败", error);
      // 不能落到最外层 catch：那会把「读不到角色」答成「你没登录」，
      // 客户端于是清会话、跳登录页，而重新登录并不会让那次读取成功。
      return { success: false, error: SERVICE_UNAVAILABLE };
    }

    const role = parseRole(rawRole ?? undefined) ?? "member";

    return {
      success: true,
      data: { id: session.id, email: session.email ?? undefined, role },
    };
  } catch (error) {
    // 走到这里的一定是「读取本身没成功」，那不是一个关于用户的事实。
    console.error("[guards] 鉴权检查未能完成", error);
    return { success: false, error: SERVICE_UNAVAILABLE };
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
export function guardHttpStatus(error: AuthGuardError): 401 | 403 | 503 {
  if (error.code === "UNAUTHORIZED") return 401;
  // 503 而不是 403：让调用方（和监控）能分清「你没权限」与「我们没读到」，
  // 前者重投多少次都一样，后者重试就可能成功。
  if (error.code === "SERVICE_UNAVAILABLE") return 503;
  return 403;
}
