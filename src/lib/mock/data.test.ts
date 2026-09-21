/**
 * mock 数据层的取值域回归（D04 补集的第一现场）。
 *
 * 起因：`generateMockNotifications` 曾自行发明 `info/success/warning/error` 四种通知类型，
 * 而真实的 `NOTIFICATION_TYPES` 是另外 7 个。页面用 `t(\`notifications.list.types.${type}\`)`
 * 取标签并被 `try/catch` 兜住，于是开发/E2E 环境每次渲染都在抛 `MISSING_MESSAGE` 后退回英文原串，
 * 而 `check:i18n` 按设计不扫动态模板——没有任何测试或门禁会发现。
 * 这里把「mock 生成的枚举值必须落在代码里的权威集合内」钉住。
 */
import { describe, expect, it } from "vitest";
import {
  generateMockNotifications,
  generateMockProfile,
  generateMockTeamMembers,
} from "./data";
import { NOTIFICATION_TYPES } from "@/lib/notifications/types";
import { PROFILE_LANGUAGES, SYSTEM_ROLES, TEAM_ROLES } from "@/lib/constants";

describe("mock 枚举值必须落在权威集合内", () => {
  it("通知类型取自 NOTIFICATION_TYPES，不得自造", () => {
    const rows = generateMockNotifications(40);
    expect(rows.length).toBe(40);
    for (const row of rows) {
      expect(NOTIFICATION_TYPES, `mock 生成了不存在的通知类型 ${row.type}`).toContain(row.type);
    }
    // 40 条里应当覆盖到多个类型；只生成一种说明取样逻辑退化了
    expect(new Set(rows.map((row) => row.type)).size).toBeGreaterThan(1);
  });

  it("profile 的 role 与 language 落在系统角色与语言偏好集合内", () => {
    const profile = generateMockProfile();
    expect(SYSTEM_ROLES).toContain(profile.role);
    expect(PROFILE_LANGUAGES).toContain(profile.language);
  });

  it("团队成员角色落在 TEAM_ROLES 内", () => {
    for (const member of generateMockTeamMembers(12)) {
      expect(TEAM_ROLES, `mock 生成了不存在的团队角色 ${member.role}`).toContain(member.role);
    }
  });
});
