/**
 * 设置表单验证规则测试
 */
import { describe, it, expect } from "vitest";
import {
  notificationSettingsSchema,
  appearanceSettingsSchema,
  securitySettingsSchema,
} from "./settings";

describe("notificationSettingsSchema", () => {
  it("应使用默认值创建有效设置", () => {
    const result = notificationSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.emailNotifications).toBe(true);
      expect(result.data.marketingEmails).toBe(false);
    }
  });
  it("应接受字段覆盖", () => {
    const result = notificationSettingsSchema.safeParse({ emailNotifications: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.emailNotifications).toBe(false);
    }
  });
});

describe("appearanceSettingsSchema", () => {
  it("主题默认为 system", () => {
    const result = appearanceSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.theme).toBe("system");
  });
  it("应拒绝无效主题值", () => {
    const result = appearanceSettingsSchema.safeParse({ theme: "blue" });
    expect(result.success).toBe(false);
  });
});

describe("securitySettingsSchema", () => {
  it("应校验密码一致性", () => {
    const result = securitySettingsSchema.safeParse({
      newPassword: "password123",
      confirmNewPassword: "different456",
    });
    expect(result.success).toBe(false);
  });
  it("密码匹配时应通过", () => {
    const result = securitySettingsSchema.safeParse({
      currentPassword: "oldpass",
      newPassword: "newpassword123",
      confirmNewPassword: "newpassword123",
    });
    expect(result.success).toBe(true);
  });
  it("新密码长度至少8位", () => {
    const result = securitySettingsSchema.safeParse({ newPassword: "1234567" });
    expect(result.success).toBe(false);
  });
});
