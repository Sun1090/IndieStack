/**
 * contact 表单校验单测（B10）
 */
import { describe, it, expect } from "vitest";
import { contactSchema } from "./contact";

describe("contactSchema", () => {
  const valid = { name: "张三", email: "a@b.com", subject: "咨询", message: "你好" };

  it("合法输入通过", () => {
    expect(contactSchema.safeParse(valid).success).toBe(true);
  });

  it("空白姓名/主题/内容分别报对应键", () => {
    expect(contactSchema.safeParse({ ...valid, name: "  " }).error?.issues[0]?.message).toBe(
      "nameRequired",
    );
    expect(contactSchema.safeParse({ ...valid, subject: "" }).error?.issues[0]?.message).toBe(
      "subjectRequired",
    );
    expect(contactSchema.safeParse({ ...valid, message: "" }).error?.issues[0]?.message).toBe(
      "messageRequired",
    );
  });

  it("非法邮箱报 emailInvalid", () => {
    expect(
      contactSchema.safeParse({ ...valid, email: "nope" }).error?.issues[0]?.message,
    ).toBe("emailInvalid");
  });

  it("超长字段被拒绝", () => {
    expect(
      contactSchema.safeParse({ ...valid, message: "x".repeat(5001) }).success,
    ).toBe(false);
  });
});
