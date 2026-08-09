/**
 * PermissionGate 权限门组件
 * ======================
 *
 * 客户端组件，根据用户的角色或权限条件性渲染子元素。
 * 支持三种模式：
 *   1. requireRole — 要求用户角色不低于指定等级
 *   2. requirePermission — 要求用户拥有指定权限
 *   3. requireAll / requireAny — 多权限校验
 *
 * 使用方式：
 *   <PermissionGate requirePermission="team:invite">
 *     <Button>邀请成员</Button>
 *   </PermissionGate>
 *
 *   <PermissionGate requireRole="admin" fallback={<span>无权限</span>}>
 *     <AdminPanel />
 *   </PermissionGate>
 */

"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { hasPermission, hasAnyPermission, getRoleLevel, type Role, parseRole } from "@/lib/auth/roles";
import type { Permission } from "@/lib/auth/permissions";

type PermissionGateProps = {
  children: React.ReactNode;

  /** 要求的最低角色等级 */
  requireRole?: Role;

  /** 要求的单个权限 */
  requirePermission?: Permission;

  /** 要求的全部权限（AND） */
  requireAll?: Permission[];

  /** 要求的任一权限（OR） */
  requireAny?: Permission[];

  /** 不满足条件时的渲染内容（默认：null，即不渲染任何内容） */
  fallback?: React.ReactNode;

  /** 加载状态渲染内容 */
  loading?: React.ReactNode;
};

export function PermissionGate({
  children,
  requireRole: minRole,
  requirePermission: singlePermission,
  requireAll,
  requireAny,
  fallback = null,
  loading = null,
}: PermissionGateProps) {
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchRole() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          if (!cancelled) {
            setUserRole("viewer");
            setIsLoading(false);
          }
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single() as { data: { role: string } | null };

        if (!cancelled) {
          setUserRole(parseRole(profile?.role as string | undefined) ?? "member");
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setUserRole("viewer");
          setIsLoading(false);
        }
      }
    }

    fetchRole();
    return () => { cancelled = true; };
  }, []);

  if (isLoading) return loading;
  if (!userRole) return fallback;

  // 角色等级校验
  if (minRole) {
    const roleLevels: Record<Role, number> = {
      super_admin: 100,
      admin: 80,
      member: 50,
      viewer: 10,
    };
    if ((roleLevels[userRole] ?? 0) < (roleLevels[minRole] ?? 0)) {
      return fallback;
    }
  }

  // 单个权限校验
  if (singlePermission && !hasPermission(userRole, singlePermission)) {
    return fallback;
  }

  // 全部权限校验（AND）
  if (requireAll && requireAll.length > 0) {
    const allGranted = requireAll.every((p) => hasPermission(userRole, p));
    if (!allGranted) return fallback;
  }

  // 任一权限校验（OR）
  if (requireAny && requireAny.length > 0) {
    const anyGranted = hasAnyPermission(userRole, requireAny);
    if (!anyGranted) return fallback;
  }

  return <>{children}</>;
}

/**
 * 权限判断 Hook（客户端使用）
 * 返回当前用户的角色和权限校验结果
 */
export function usePermissions() {
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchRole() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) { setUserRole("viewer"); setIsLoading(false); }
          return;
        }
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single() as { data: { role: string } | null };
        if (!cancelled) {
          setUserRole(parseRole(profile?.role as string | undefined) ?? "member");
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) { setUserRole("viewer"); setIsLoading(false); }
      }
    }

    fetchRole();
    return () => { cancelled = true; };
  }, []);

  return {
    role: userRole,
    isLoading,
    can: (permission: Permission) => userRole ? hasPermission(userRole, permission) : false,
    isAtLeast: (role: Role) => userRole ? getRoleLevel(userRole) >= getRoleLevel(role) : false,
  };
}
