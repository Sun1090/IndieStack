/**
 * 团队管理表单验证规则测试
 */
import { describe, it, expect } from "vitest";
import { createTeamSchema, inviteMemberSchema, updateTeamSchema } from "./team";

describe("createTeamSchema", () => {
  it("应接受有效的团队数据", () => {
    const result = createTeamSchema.safeParse({ name: "我的团队", slug: "my-team" });
    expect(result.success).toBe(true);
  });
  it("空名称应被拒绝", () => {
    expect(createTeamSchema.safeParse({ name: "", slug: "test" }).success).toBe(false);
  });
  it("slug 仅允许小写字母、数字和连字符", () => {
    expect(createTeamSchema.safeParse({ name: "T", slug: "大写" }).success).toBe(false);
    expect(createTeamSchema.safeParse({ name: "T", slug: "valid-slug-123" }).success).toBe(true);
  });
});

describe("inviteMemberSchema", () => {
  it("应接受有效邀请数据", () => {
    const result = inviteMemberSchema.safeParse({ email: "user@example.com", role: "member" });
    expect(result.success).toBe(true);
  });
  it("应拒绝无效邮箱", () => {
    expect(inviteMemberSchema.safeParse({ email: "bad" }).success).toBe(false);
  });
  it("角色默认为 member", () => {
    const result = inviteMemberSchema.safeParse({ email: "user@example.com" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.role).toBe("member");
  });
});

describe("updateTeamSchema", () => {
  it("所有字段可选", () => {
    expect(updateTeamSchema.safeParse({}).success).toBe(true);
  });
  it("应验证 slug 格式", () => {
    expect(updateTeamSchema.safeParse({ slug: "valid-slug" }).success).toBe(true);
    expect(updateTeamSchema.safeParse({ slug: "Invalid Slug!" }).success).toBe(false);
  });
});
