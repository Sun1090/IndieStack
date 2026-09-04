/**
 * TOTP 验证码校验（B10：由 actions/mfa 内联正则抽取，单测见 mfa.test.ts）
 */

/** 去空白并校验 6 位数字；非法返回 null */
export function normalizeTotpCode(code: string): string | null {
  const cleaned = code.replace(/\s+/g, "");
  return /^\d{6}$/.test(cleaned) ? cleaned : null;
}

/** 恢复码字符集（去易混淆字符） */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 每次生成的恢复码数量 */
export const RECOVERY_CODE_COUNT = 10;

/** 恢复码归一化：去分隔符/空白转大写，8 位合法字符；非法返回 null */
export function normalizeRecoveryCode(code: string): string | null {
  const cleaned = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return /^[A-HJ-KM-NP-Z2-9]{8}$/.test(cleaned) ? cleaned : null;
}

/** 生成一张明文恢复码（XXXX-XXXX 分组展示） */
export function generateRecoveryCode(random: (n: number) => number): string {
  let raw = "";
  for (let i = 0; i < 8; i++) raw += RECOVERY_ALPHABET[random(RECOVERY_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
