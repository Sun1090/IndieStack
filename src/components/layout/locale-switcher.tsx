"use client";

/**
 * 语言切换器组件
 * 在下拉菜单中显示支持的语言列表，切换时更新 Cookie 并刷新页面以应用新语言
 * 采用 Cookie 方案（localePrefix: 'never'），无需修改 URL 路径
 */
import { useCallback } from "react";
import { useLocale } from "next-intl";
import { locales, localeMeta, LOCALE_COOKIE_NAME, type Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Globe } from "lucide-react";

export function LocaleSwitcher() {
  const currentLocale = useLocale() as Locale;

  // 切换语言：设置 Cookie 并刷新页面以应用新语言
  const switchLocale = useCallback((locale: Locale) => {
    document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    window.location.reload();
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Globe className="h-4 w-4" />
          <span className="sr-only">切换语言 / Switch language</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => switchLocale(locale)}
            className={locale === currentLocale ? "font-bold" : ""}
          >
            <span className="mr-2">{localeMeta[locale].flag}</span>
            {localeMeta[locale].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
