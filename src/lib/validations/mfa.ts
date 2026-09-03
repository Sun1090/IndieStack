/**
 * TOTP 验证码校验（B10：由 actions/mfa 内联正则抽取，单测见 mfa.test.ts）
 */

/** 去空白并校验 6 位数字；非法返回 null */
export function normalizeTotpCode(code: string): string | null {
  const cleaned = code.replace(/\s+/g, "");
  return /^\d{6}$/.test(cleaned) ? cleaned : null;
}
