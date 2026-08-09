/**
 * 独立开发技术栈 RBAC 权限系统
 * ======================
 *
 * 权限分为两个层级：
 * 1. 系统级权限（system:*）— 全局操作如用户管理、系统设置
 * 2. 资源级权限（resource:action）— 针对具体资源的操作
 *
 * 命名规范：<domain>:<action>
 * 支持的 action：read / write / create / delete / manage / invite / remove
 *
 * 使用方式：
 *   import { hasPermission, PERMISSIONS } from "@/lib/auth/permissions"
 *   hasPermission(userRole, PERMISSIONS.team.invite) // => true/false
 */

// ============================================================
// 权限定义 — 扁平字符串常量，便于序列化和存储
// ============================================================

/** 所有可用权限的字符串联合类型 */
export type Permission =
  // ---- 用户管理 ----
  | "user:read"
  | "user:write"
  | "user:delete"
  | "user:manage"

  // ---- 团队管理 ----
  | "team:read"
  | "team:write"
  | "team:delete"
  | "team:invite"
  | "team:remove"

  // ---- 项目管理 ----
  | "project:read"
  | "project:write"
  | "project:delete"
  | "project:manage"

  // ---- 结算与订阅 ----
  | "billing:read"
  | "billing:write"
  | "billing:manage"

  // ---- 设置 ----
  | "settings:read"
  | "settings:write"

  // ---- 分析 ----
  | "analytics:read"
  | "analytics:export"

  // ---- 集成 ----
  | "integration:read"
  | "integration:write"

  // ---- 通知 ----
  | "notification:read"
  | "notification:write"

  // ---- 系统管理 ----
  | "system:read"
  | "system:write"
  | "system:manage"

  // ---- 审核日志 ----
  | "audit:read"
  | "audit:export";

/**
 * 便捷权限引用对象
 * 使用：PERMISSIONS.team.invite 而非手写 "team:invite"
 */
export const PERMISSIONS = {
  user: {
    read: "user:read" as Permission,
    write: "user:write" as Permission,
    delete: "user:delete" as Permission,
    manage: "user:manage" as Permission,
  },
  team: {
    read: "team:read" as Permission,
    write: "team:write" as Permission,
    delete: "team:delete" as Permission,
    invite: "team:invite" as Permission,
    remove: "team:remove" as Permission,
  },
  project: {
    read: "project:read" as Permission,
    write: "project:write" as Permission,
    delete: "project:delete" as Permission,
    manage: "project:manage" as Permission,
  },
  billing: {
    read: "billing:read" as Permission,
    write: "billing:write" as Permission,
    manage: "billing:manage" as Permission,
  },
  settings: {
    read: "settings:read" as Permission,
    write: "settings:write" as Permission,
  },
  analytics: {
    read: "analytics:read" as Permission,
    export: "analytics:export" as Permission,
  },
  integration: {
    read: "integration:read" as Permission,
    write: "integration:write" as Permission,
  },
  notification: {
    read: "notification:read" as Permission,
    write: "notification:write" as Permission,
  },
  system: {
    read: "system:read" as Permission,
    write: "system:write" as Permission,
    manage: "system:manage" as Permission,
  },
  audit: {
    read: "audit:read" as Permission,
    export: "audit:export" as Permission,
  },
} as const;

/**
 * 校验字符串是否为有效权限
 */
export function isValidPermission(p: string): p is Permission {
  return Object.values(PERMISSIONS).some((group) =>
    Object.values(group).includes(p as Permission)
  );
}

/**
 * 根据域名获取该域下所有权限
 */
export function getPermissionsByDomain(domain: string): Permission[] {
  const group = (PERMISSIONS as Record<string, Record<string, Permission>>)[domain];
  return group ? Object.values(group) : [];
}

/**
 * 将权限数组转为 Set（高效查询）
 */
export function toPermissionSet(perms: Permission[]): Set<Permission> {
  return new Set(perms);
}
