"use client";

/**
 * 密码强度指示条
 * 纯前端评分：长度 + 字符类别（小写/大写/数字/符号）
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

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

const LABELS: Record<StrengthLevel, string> = {
  0: "",
  1: "weak",
  2: "fair",
  3: "good",
  4: "strong",
};

const BAR_COLORS: Record<StrengthLevel, string> = {
  0: "bg-transparent",
  1: "bg-red-500",
  2: "bg-amber-500",
  3: "bg-sky-500",
  4: "bg-emerald-500",
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
        {level > 0 ? t(`strength.${LABELS[level]}`) : ""}
      </p>
    </div>
  );
}
