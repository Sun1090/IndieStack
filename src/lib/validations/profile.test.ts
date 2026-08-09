/**
 * 个人资料表单验证规则测试
 */
import { describe, it, expect } from "vitest";
import { profileUpdateSchema, profileSettingsSchema } from "./profile";

describe("profileUpdateSchema", () => {
  it("应接受有效数据", () => {
    const result = profileUpdateSchema.safeParse({ fullName: "张三" });
    expect(result.success).toBe(true);
  });
  it("应允许可选字段为空", () => {
    const result = profileUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
  it("应拒绝超长名称", () => {
    const result = profileUpdateSchema.safeParse({ fullName: "a".repeat(101) });
    expect(result.success).toBe(false);
  });
  it("应验证 avatarUrl 格式", () => {
    const result = profileUpdateSchema.safeParse({ avatarUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });
});

describe("profileSettingsSchema", () => {
  it("应接受完整有效数据", () => {
    const result = profileSettingsSchema.safeParse({
      fullName: "张三",
      email: "zhang@example.com",
      bio: "独立开发者",
      timezone: "Asia/Shanghai",
      language: "zh-CN",
    });
    expect(result.success).toBe(true);
  });
  it("名称字段必填", () => {
    const result = profileSettingsSchema.safeParse({ fullName: "" });
    expect(result.success).toBe(false);
  });
  it("bio 超长应拒绝", () => {
    const result = profileSettingsSchema.safeParse({ fullName: "张三", bio: "x".repeat(501) });
    expect(result.success).toBe(false);
  });
});
