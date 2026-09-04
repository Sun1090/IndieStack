/**
 * contact 表单校验单测（B10）
 */
import { describe, it, expect } from "vitest";
import { contactSchema, scoreSpam, isSpam, SPAM_REJECT_SCORE } from "./contact";

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

describe("scoreSpam/isSpam", () => {
  const corp = { message: "你好，我想咨询企业版的价格与部署方式，谢谢。", email: "boss@company.com" };

  it("正常咨询低分通过", () => {
    expect(isSpam(corp)).toBe(false);
    expect(scoreSpam(corp).score).toBeLessThan(SPAM_REJECT_SCORE);
  });

  it("多链接命中", () => {
    const r = scoreSpam({ message: "点击 http://a.com 和 https://b.com 还有 www.c.com 领奖", email: "x@company.com" });
    expect(r.score).toBeGreaterThanOrEqual(45);
    expect(r.reasons.join()).toContain("links:3");
  });

  it("长重复串命中", () => {
    expect(scoreSpam({ message: `优惠${"!".repeat(12)}速来`, email: "x@company.com" }).reasons).toContain("repeat-run");
  });

  it("全大写英文命中", () => {
    const r = scoreSpam({ message: "CONGRATULATIONS YOU HAVE WON A FREE PRIZE CLICK HERE NOW", email: "x@company.com" });
    expect(r.reasons).toContain("all-caps");
  });

  it("短文带链加权", () => {
    expect(scoreSpam({ message: "看 http://x.com", email: "x@company.com" }).reasons).toContain("short-with-link");
  });

  it("免费邮箱+多链组合加权", () => {
    const r = scoreSpam({ message: "see http://a.com and http://b.com ok", email: "spam@qq.com" });
    expect(r.reasons).toContain("free-mail-links");
  });

  it("阈值边界：组合信号触发拒收", () => {
    expect(isSpam({ message: "中奖了!!! http://a.com http://b.com http://c.com 快来领", email: "spam@qq.com" })).toBe(true);
  });
});
