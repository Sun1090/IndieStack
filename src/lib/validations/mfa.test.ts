/**
 * TOTP 验证码校验单测（B10）
 */
import { describe, it, expect } from "vitest";
import { normalizeTotpCode, normalizeRecoveryCode, generateRecoveryCode } from "./mfa";

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

describe("normalizeRecoveryCode", () => {
  it("分组/小写/空白归一化", () => {
    expect(normalizeRecoveryCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeRecoveryCode(" abcd 2345 ")).toBe("ABCD2345");
  });

  it("非法字符或长度返回 null", () => {
    expect(normalizeRecoveryCode("ABCD-234")).toBeNull();
    expect(normalizeRecoveryCode("ABCD-23455")).toBeNull();
    expect(normalizeRecoveryCode("ABCD-2340")).toBeNull(); // I 不在字符集
    expect(normalizeRecoveryCode("")).toBeNull();
  });
});

describe("generateRecoveryCode", () => {
  it("XXXX-XXXX 分组且字符合法", () => {
    const code = generateRecoveryCode((n) => n - 1);
    expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
    expect(normalizeRecoveryCode(code)).not.toBeNull();
  });
});
