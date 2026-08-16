"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * 主题切换按钮
 * 优先按"当前实际显示的主题"切换：当用户处于 system 模式时，
 * 先解析系统偏好再取反，保证每次点击都有可见反馈。
 */
export function ThemeToggle() {
  const t = useTranslations("common");
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    const resolved =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    setTheme(resolved === "light" ? "dark" : "light");
  };

  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={t("toggleTheme")}>
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">{t("toggleTheme")}</span>
    </Button>
  );
}
