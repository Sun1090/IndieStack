"use client";

/**
 * 外观设置表单
 * 使用 next-themes 的 ThemeProvider 切换浅色、深色或跟随系统
 */

import { useTranslations } from "next-intl";
import { useTheme } from "@/components/providers/theme-provider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FormField, FormFieldControl, FormFieldLabel } from "@/components/shared/form-field";

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
          // 卡片式单选项：FormField 只负责接线，`peer` 选中态排布由下面的 label 自己接管，
          // 因此显式传空 className 去掉默认的 space-y-2。
          <FormField key={option.value} htmlFor={`theme-${option.value}`} className="">
            <FormFieldControl>
              <RadioGroupItem value={option.value} className="peer sr-only" />
            </FormFieldControl>
            <FormFieldLabel className="border-input peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 flex cursor-pointer items-center justify-center rounded-lg border px-4 py-3 text-sm font-medium transition-colors">
              {t(option.labelKey)}
            </FormFieldLabel>
          </FormField>
        ))}
      </RadioGroup>
    </div>
  );
}
