/**
 * TOTP 验证码校验单测（B10）
 */
import { describe, it, expect } from "vitest";
import { normalizeTotpCode } from "./mfa";

describe("normalizeTotpCode", () => {
  it("6 位数字通过", () => {
    expect(normalizeTotpCode("123456")).toBe("123456");
  });

  it("空白被去除后通过", () => {
    expect(normalizeTotpCode(" 123 456 ")).toBe("123456");
  });

  it("非 6 位/含字母返回 null", () => {
    expect(normalizeTotpCode("12345")).toBeNull();
    expect(normalizeTotpCode("1234567")).toBeNull();
    expect(normalizeTotpCode("abc123")).toBeNull();
    expect(normalizeTotpCode("")).toBeNull();
  });
});
