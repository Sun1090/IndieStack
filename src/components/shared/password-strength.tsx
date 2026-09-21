"use client";

/**
 * 密码强度指示条
 * 纯前端评分：长度 + 字符类别（小写/大写/数字/符号）
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { scorePassword, STRENGTH_LABELS } from "@/lib/password-strength";
import type { StrengthLevel } from "@/lib/password-strength";
import { cn } from "@/lib/utils";

export { scorePassword } from "@/lib/password-strength";
export type { StrengthLevel } from "@/lib/password-strength";

const BAR_COLORS: Record<StrengthLevel, string> = {
  0: "bg-transparent",
  1: "bg-destructive",
  2: "bg-warning",
  3: "bg-info",
  4: "bg-success",
};

export function PasswordStrength({ password }: { password: string }) {
  const t = useTranslations("common");
  const level = useMemo(() => scorePassword(password), [password]);
  if (!password) return null;

  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i <= level ? BAR_COLORS[level] : "bg-muted",
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {level > 0 ? t(`strength.${STRENGTH_LABELS[level]}`) : ""}
      </p>
    </div>
  );
}
