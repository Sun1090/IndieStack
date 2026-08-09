/**
 * next-intl 路由配置
 * 定义支持的语言、默认语言和路由策略
 *
 * 采用 localePrefix: 'never' 策略：
 * - 语言偏好存储在 Cookie 中，不体现在 URL 路径里
 * - 避免调整现有路由结构，保持 URL 简洁
 * - 通过客户端语言切换器更新 Cookie，刷新页面应用新语言
 */
import { defineRouting } from "next-intl/routing";

/** 支持的语言列表 */
export const locales = ["zh-CN", "en"] as const;

/** 默认语言 */
export const defaultLocale = "zh-CN" as const;

/** 语言类型 */
export type Locale = (typeof locales)[number];

/** Cookie 名称：用于存储用户语言偏好 */
export const LOCALE_COOKIE_NAME = "app-locale";

/** 语言配置元数据（用于语言切换器显示） */
export const localeMeta: Record<Locale, { label: string; flag: string }> = {
  "zh-CN": { label: "简体中文", flag: "🇨🇳" },
  en: { label: "English", flag: "🇺🇸" },
};

/** next-intl 路由定义 */
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "never",
});

/**
 * 判断字符串是否为支持的语言
 */
export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}

/**
 * 获取安全的语言值，若不支持则返回默认语言
 */
export function getSafeLocale(locale: string | undefined): Locale {
  if (locale && isValidLocale(locale)) return locale;
  return defaultLocale;
}
