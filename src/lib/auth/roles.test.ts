/**
 * RBAC 角色权限单元测试
 * 验证权限矩阵、角色等级、权限判定与角色解析
 */
import { describe, it, expect } from "vitest";
import {
  ROLES,
  ROLE_HIERARCHY,
  getRolePermissions,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  getRoleLevel,
  isRoleAtLeast,
  getAllRolesWithPermissions,
  parseRole,
  teamRoleToSystemRole,
} from "./roles";
import { PERMISSIONS, type Permission } from "./permissions";

/** 全部 30 个权限 */
const ALL_PERMISSIONS: Permission[] = [
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

const viewerPermissions: Permission[] = [
  PERMISSIONS.user.read,
  PERMISSIONS.team.read,
  PERMISSIONS.project.read,
  PERMISSIONS.analytics.read,
  PERMISSIONS.notification.read,
  PERMISSIONS.settings.read,
];

const memberPermissions: Permission[] = [
  ...viewerPermissions,
  PERMISSIONS.user.write,
  PERMISSIONS.project.write,
  PERMISSIONS.billing.read,
  PERMISSIONS.integration.read,
  PERMISSIONS.notification.write,
  PERMISSIONS.settings.write,
];

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

const expectedMatrix: Record<(typeof ROLES)[number], Permission[]> = {
  viewer: viewerPermissions,
  member: memberPermissions,
  admin: adminPermissions,
  super_admin: ALL_PERMISSIONS,
};

describe("ROLES / ROLE_HIERARCHY", () => {
  it("应包含 4 个内置角色且等级严格递减", () => {
    expect(ROLES).toEqual(["super_admin", "admin", "member", "viewer"]);
    expect(ROLE_HIERARCHY.super_admin).toBeGreaterThan(ROLE_HIERARCHY.admin);
    expect(ROLE_HIERARCHY.admin).toBeGreaterThan(ROLE_HIERARCHY.member);
    expect(ROLE_HIERARCHY.member).toBeGreaterThan(ROLE_HIERARCHY.viewer);
  });
});

describe("getRolePermissions()", () => {
  it("应返回各角色的完整权限列表", () => {
    for (const role of ROLES) {
      expect(getRolePermissions(role).sort()).toEqual([...expectedMatrix[role]].sort());
    }
  });

  it("应返回副本，避免调用方修改内部状态", () => {
    const perms = getRolePermissions("admin");
    perms.push(PERMISSIONS.system.read);
    expect(getRolePermissions("admin")).not.toContain(PERMISSIONS.system.read);
  });
});

describe("hasPermission()", () => {
  it("应精确匹配权限矩阵", () => {
    for (const role of ROLES) {
      const expected = new Set(expectedMatrix[role]);
      for (const permission of ALL_PERMISSIONS) {
        expect(
          hasPermission(role, permission),
          `${role} 应${expected.has(permission) ? "" : "不"}拥有 ${permission}`,
        ).toBe(expected.has(permission));
      }
    }
  });

  it("对未知角色应返回 false", () => {
    expect(hasPermission("root" as never, PERMISSIONS.user.read)).toBe(false);
  });
});

describe("hasAllPermissions() / hasAnyPermission()", () => {
  it("hasAllPermissions 仅在所有权限都具备时为 true", () => {
    expect(hasAllPermissions("admin", [PERMISSIONS.team.invite, PERMISSIONS.project.manage])).toBe(
      true,
    );
    expect(hasAllPermissions("member", [PERMISSIONS.team.invite, PERMISSIONS.project.read])).toBe(
      false,
    );
  });

  it("hasAllPermissions 对空数组返回 true（空真）", () => {
    expect(hasAllPermissions("viewer", [])).toBe(true);
  });

  it("hasAnyPermission 具备任一权限即为 true", () => {
    expect(hasAnyPermission("viewer", [PERMISSIONS.team.invite, PERMISSIONS.project.read])).toBe(
      true,
    );
    expect(hasAnyPermission("viewer", [PERMISSIONS.team.invite, PERMISSIONS.billing.manage])).toBe(
      false,
    );
  });

  it("对未知角色均返回 false", () => {
    expect(hasAllPermissions("root" as never, [PERMISSIONS.user.read])).toBe(false);
    expect(hasAnyPermission("root" as never, [PERMISSIONS.user.read])).toBe(false);
  });
});

describe("getRoleLevel() / isRoleAtLeast()", () => {
  it("getRoleLevel 返回等级数值", () => {
    expect(getRoleLevel("super_admin")).toBe(100);
    expect(getRoleLevel("admin")).toBe(80);
    expect(getRoleLevel("member")).toBe(50);
    expect(getRoleLevel("viewer")).toBe(10);
  });

  it("isRoleAtLeast 判断高低级关系", () => {
    expect(isRoleAtLeast("admin", "member")).toBe(true);
    expect(isRoleAtLeast("admin", "admin")).toBe(true);
    expect(isRoleAtLeast("member", "admin")).toBe(false);
    expect(isRoleAtLeast("viewer", "super_admin")).toBe(false);
  });
});

describe("getAllRolesWithPermissions()", () => {
  it("应返回所有角色的权限映射", () => {
    const map = getAllRolesWithPermissions();
    expect(Object.keys(map)).toEqual(ROLES);
    for (const role of ROLES) {
      expect(map[role].sort()).toEqual([...expectedMatrix[role]].sort());
    }
  });
});

describe("parseRole()", () => {
  it("应解析有效角色", () => {
    expect(parseRole("admin")).toBe("admin");
    expect(parseRole("super_admin")).toBe("super_admin");
  });

  it("对无效输入返回 undefined", () => {
    expect(parseRole("owner")).toBeUndefined();
    expect(parseRole("")).toBeUndefined();
    expect(parseRole(undefined)).toBeUndefined();
    expect(parseRole(null)).toBeUndefined();
  });
});

describe("teamRoleToSystemRole()", () => {
  it("owner/admin 映射为 admin，member 映射为 member", () => {
    expect(teamRoleToSystemRole("owner")).toBe("admin");
    expect(teamRoleToSystemRole("admin")).toBe("admin");
    expect(teamRoleToSystemRole("member")).toBe("member");
  });
});
