"use client";

/**
 * 全局 Provider 组件（客户端）
 * 包裹所有子组件，提供：i18n 国际化、主题管理、Tooltip、Toast 通知
 * 使用 next-intl 的 NextIntlClientProvider 接收服务端已加载的 messages
 */
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import type { Locale } from "@/i18n/routing";

export function Providers({
  children,
  locale,
  messages,
}: {
  children: React.ReactNode;
  locale: Locale;
  messages: Record<string, unknown>;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Shanghai">
      <ThemeProvider defaultTheme="system" storageKey="ui-theme">
        <TooltipProvider delayDuration={0}>
          {children}
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
