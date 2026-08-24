"use client";

/**
 * 资料完整度指示条
 * 按已填字段比例计算：姓名/头像/简介/时区 各占 25%
 */

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export function ProfileCompleteness({
  fields,
}: {
  fields: { filled: boolean; label: string }[];
}) {
  const t = useTranslations("common");
  const filled = fields.filter((f) => f.filled).length;
  const percent = Math.round((filled / fields.length) * 100);

  return (
    <div className="space-y-2" aria-label={t("profileCompleteness")}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t("profileCompleteness")}</span>
        <span className="font-medium">{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            percent === 100 ? "bg-emerald-500" : percent >= 50 ? "bg-sky-500" : "bg-amber-500",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {fields.map((f) => (
          <li key={f.label} className={cn(f.filled ? "text-muted-foreground line-through" : "text-foreground")}>
            {f.filled ? "✓" : "○"} {f.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
