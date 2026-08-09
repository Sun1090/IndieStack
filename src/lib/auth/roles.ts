/**
 * 独立开发技术栈 角色定义
 * ======================
 *
 * 内置角色（按权限从高到低）：
 *   super_admin → admin → member → viewer
 *
 * 角色-权限映射规则：
 *   - super_admin 拥有所有权限
 *   - admin 拥有 adminPermissions 中的权限
 *   - member 拥有 memberPermissions 中的权限
 *   - viewer 仅拥有 viewerPermissions 中的权限
 *
 * 使用方式：
 *   import { getRolePermissions, hasPermission } from "@/lib/auth/roles"
 *   hasPermission("admin", "team:invite") // => true
 */

import type { Permission } from "./permissions";
import { PERMISSIONS, toPermissionSet } from "./permissions";

// ============================================================
// 角色类型定义
// ============================================================

/** 系统内置角色 */
export type Role = "super_admin" | "admin" | "member" | "viewer";

/** 团队内角色（用于 team_members.role） */
export type TeamRole = "owner" | "admin" | "member";

/**
 * 所有可用角色列表
 */
export const ROLES: Role[] = ["super_admin", "admin", "member", "viewer"];

/**
 * 角色等级（数字越大权限越高）
 */
export const ROLE_HIERARCHY: Record<Role, number> = {
  super_admin: 100,
  admin: 80,
  member: 50,
  viewer: 10,
};

// ============================================================
// 角色-权限映射表
// ============================================================

/** viewer 级别权限：仅只读 */
const viewerPermissions: Permission[] = [
  PERMISSIONS.user.read,
  PERMISSIONS.team.read,
  PERMISSIONS.project.read,
  PERMISSIONS.analytics.read,
  PERMISSIONS.notification.read,
  PERMISSIONS.settings.read,
];

/** member 级别权限：基础读写 */
const memberPermissions: Permission[] = [
  ...viewerPermissions,
  PERMISSIONS.user.write,
  PERMISSIONS.project.write,
  PERMISSIONS.billing.read,
  PERMISSIONS.integration.read,
  PERMISSIONS.notification.write,
  PERMISSIONS.settings.write,
];

/** admin 级别权限：管理操作 */
const adminPermissions: Permission[] = [
  ...memberPermissions,
  PERMISSIONS.team.invite,
  PERMISSIONS.team.remove,
  PERMISSIONS.team.write,
  PERMISSIONS.project.manage,
  PERMISSIONS.project.delete,
  PERMISSIONS.billing.write,
  PERMISSIONS.billing.manage,
  PERMISSIONS.integration.write,
  PERMISSIONS.analytics.export,
  PERMISSIONS.user.manage,
];

/** super_admin 拥有所有权限 */
const allPermissions: Permission[] = [
  PERMISSIONS.user.read,
  PERMISSIONS.user.write,
  PERMISSIONS.user.delete,
  PERMISSIONS.user.manage,
  PERMISSIONS.team.read,
  PERMISSIONS.team.write,
  PERMISSIONS.team.delete,
  PERMISSIONS.team.invite,
  PERMISSIONS.team.remove,
  PERMISSIONS.project.read,
  PERMISSIONS.project.write,
  PERMISSIONS.project.delete,
  PERMISSIONS.project.manage,
  PERMISSIONS.billing.read,
  PERMISSIONS.billing.write,
  PERMISSIONS.billing.manage,
  PERMISSIONS.settings.read,
  PERMISSIONS.settings.write,
  PERMISSIONS.analytics.read,
  PERMISSIONS.analytics.export,
  PERMISSIONS.integration.read,
  PERMISSIONS.integration.write,
  PERMISSIONS.notification.read,
  PERMISSIONS.notification.write,
  PERMISSIONS.system.read,
  PERMISSIONS.system.write,
  PERMISSIONS.system.manage,
  PERMISSIONS.audit.read,
  PERMISSIONS.audit.export,
];

/** 角色 → 权限列表映射 */
const rolePermissionsMap: Record<Role, Permission[]> = {
  super_admin: allPermissions,
  admin: adminPermissions,
  member: memberPermissions,
  viewer: viewerPermissions,
};

// 缓存 Set 版本，避免每次查询都创建新 Set
const rolePermissionSets = new Map<Role, Set<Permission>>();
for (const [role, perms] of Object.entries(rolePermissionsMap)) {
  rolePermissionSets.set(role as Role, toPermissionSet(perms));
}

// ============================================================
// 核心函数
// ============================================================

/**
 * 获取指定角色拥有的所有权限列表
 */
export function getRolePermissions(role: Role): Permission[] {
  return [...(rolePermissionsMap[role] ?? [])];
}

/**
 * 判断指定角色是否拥有某个具体权限
 *
 * @example hasPermission("admin", "team:invite") // => true
 * @example hasPermission("viewer", "team:invite") // => false
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const set = rolePermissionSets.get(role);
  return set?.has(permission) ?? false;
}

/**
 * 判断指定角色是否拥有指定权限集合中的全部权限
 */
export function hasAllPermissions(role: Role, permissions: Permission[]): boolean {
  const set = rolePermissionSets.get(role);
  if (!set) return false;
  return permissions.every((p) => set.has(p));
}

/**
 * 判断指定角色是否拥有指定权限集合中的任一权限
 */
export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  const set = rolePermissionSets.get(role);
  if (!set) return false;
  return permissions.some((p) => set.has(p));
}

/**
 * 获取等级更高的角色（用于 UI 中的降级提示等）
 */
export function getRoleLevel(role: Role): number {
  return ROLE_HIERARCHY[role] ?? 0;
}

/**
 * 判断 roleA 的角色等级是否不低于 roleB
 */
export function isRoleAtLeast(roleA: Role, roleB: Role): boolean {
  return getRoleLevel(roleA) >= getRoleLevel(roleB);
}

/**
 * 获取所有角色的权限映射（用于系统配置界面展示）
 */
export function getAllRolesWithPermissions(): Record<Role, Permission[]> {
  return { ...rolePermissionsMap };
}

/**
 * 将字符串转为 Role 类型，无效值返回 undefined
 */
export function parseRole(roleStr: string | undefined | null): Role | undefined {
  if (roleStr && ROLES.includes(roleStr as Role)) {
    return roleStr as Role;
  }
  return undefined;
}

/**
 * 将团队角色映射到系统角色
 * owner / admin → admin
 * member → member
 */
export function teamRoleToSystemRole(teamRole: TeamRole): Role {
  switch (teamRole) {
    case "owner":
    case "admin":
      return "admin";
    case "member":
      return "member";
    default:
      return "member";
  }
}
