"use client";

/**
 * 外观设置表单
 * 使用 next-themes 的 ThemeProvider 切换浅色、深色或跟随系统
 */

import { useTranslations } from "next-intl";
import { useTheme } from "@/components/providers/theme-provider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

const THEME_OPTIONS = [
  { value: "light", labelKey: "settings.sections.appearance.themeLight" },
  { value: "dark", labelKey: "settings.sections.appearance.themeDark" },
  { value: "system", labelKey: "settings.sections.appearance.themeSystem" },
] as const;

export function ThemeSettingsForm() {
  const t = useTranslations("dashboard");
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{t("settings.sections.appearance.theme")}</p>
      <RadioGroup
        value={theme}
        onValueChange={(value: "light" | "dark" | "system") => setTheme(value)}
        className="grid gap-3 sm:grid-cols-3"
      >
        {THEME_OPTIONS.map((option) => (
          <div key={option.value}>
            <RadioGroupItem
              value={option.value}
              id={`theme-${option.value}`}
              className="peer sr-only"
            />
            <Label
              htmlFor={`theme-${option.value}`}
              className="flex cursor-pointer items-center justify-center rounded-lg border border-input px-4 py-3 text-sm font-medium transition-colors peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5"
            >
              {t(option.labelKey)}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}
