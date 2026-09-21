/**
 * 密码强度评分（纯逻辑，从 `src/components/shared/password-strength.tsx` 抽出）。
 *
 * 抽到 `.ts` 有两个原因：这里没有 JSX、可被 Node 直接 import；而
 * `pnpm check:dynamic-keys` 需要知道 `t(\`strength.${label}\`)` 的**权威取值集合**
 * （`check:i18n` 按设计只扫静态 `t("字面量")`，动态模板会被跳过）。
 * 组件与测试都从这里取，避免出现第二份手抄清单。
 */

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export function scorePassword(password: string): StrengthLevel {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return Math.min(4, Math.max(1, score - (password.length < 8 ? 1 : 0))) as StrengthLevel;
}

/** 强度等级 → `common.strength.*` 的键名；0 级不显示文案，所以是空串。 */
export const STRENGTH_LABELS: Record<StrengthLevel, string> = {
  0: "",
  1: "weak",
  2: "fair",
  3: "good",
  4: "strong",
};

/** 参与翻译的强度键集合（空串是「不显示」，不是缺翻译）。 */
export const STRENGTH_LABEL_KEYS = ["weak", "fair", "good", "strong"] as const;
