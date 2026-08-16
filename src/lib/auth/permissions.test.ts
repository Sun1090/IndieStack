/**
 * 权限定义单元测试
 * 验证权限字符串常量、校验与按域查询
 */
import { describe, it, expect } from "vitest";
import {
  PERMISSIONS,
  isValidPermission,
  getPermissionsByDomain,
  toPermissionSet,
} from "./permissions";

describe("PERMISSIONS", () => {
  it("所有权限值都是合法权限字符串（一致性守卫）", () => {
    for (const group of Object.values(PERMISSIONS)) {
      for (const value of Object.values(group)) {
        expect(isValidPermission(value), `${value} 应可被 isValidPermission 识别`).toBe(true);
      }
    }
  });

  it("权限命名符合 domain:action 格式", () => {
    for (const group of Object.values(PERMISSIONS)) {
      for (const value of Object.values(group)) {
        expect(value).toMatch(/^[a-z]+:[a-z]+$/);
      }
    }
  });
});

describe("isValidPermission()", () => {
  it("合法权限返回 true", () => {
    expect(isValidPermission("team:invite")).toBe(true);
    expect(isValidPermission("system:manage")).toBe(true);
  });

  it("非法权限返回 false", () => {
    expect(isValidPermission("team:invitee")).toBe(false);
    expect(isValidPermission("root:read")).toBe(false);
    expect(isValidPermission("")).toBe(false);
  });
});

describe("getPermissionsByDomain()", () => {
  it("按域返回全部权限", () => {
    expect(getPermissionsByDomain("team").sort()).toEqual([
      "team:delete",
      "team:invite",
      "team:read",
      "team:remove",
      "team:write",
    ]);
  });

  it("未知域返回空数组", () => {
    expect(getPermissionsByDomain("unknown")).toEqual([]);
  });
});

describe("toPermissionSet()", () => {
  it("返回包含全部元素的 Set", () => {
    const set = toPermissionSet([PERMISSIONS.team.invite, PERMISSIONS.user.read]);
    expect(set).toBeInstanceOf(Set);
    expect(set.has("team:invite")).toBe(true);
    expect(set.has("user:read")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("重复元素自动去重", () => {
    const set = toPermissionSet([PERMISSIONS.team.invite, PERMISSIONS.team.invite]);
    expect(set.size).toBe(1);
  });
});
