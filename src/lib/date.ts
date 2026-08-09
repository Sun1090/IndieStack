/**
 * 日期时间工具函数
 * 基于 date-fns 提供格式化和操作日期的工具方法
 */
import { format, formatDistanceToNow, isToday, isYesterday, isThisWeek, differenceInCalendarDays } from "date-fns";
import { zhCN, enUS, type Locale } from "date-fns/locale";
import { defaultLocale } from "@/i18n/routing";

const localeMap: Record<string, Locale> = {
  "zh-CN": zhCN,
  en: enUS,
};

function getLocale(locale?: string): Locale {
  return localeMap[locale ?? defaultLocale] ?? enUS;
}

/**
 * 格式化日期为可读字符串
 * 使用 date-fns 的 format
 *
 * @example
 * formatDate(new Date("2026-07-19")) // "2026-07-19"
 * formatDate(new Date(), { pattern: "yyyy年M月d日" }) // "2026年7月19日"
 */
export function formatDate(
  date: Date | string | number,
  options: { pattern?: string; locale?: string } = {}
): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Invalid date";
  return format(d, options.pattern ?? "yyyy-MM-dd", { locale: getLocale(options.locale) });
}

/**
 * 格式化日期为相对时间（如"3 小时前"）
 * 使用 date-fns 的 formatDistanceToNow
 *
 * @example
 * formatRelativeTime(new Date(Date.now() - 3600000)) // "about 1 hour ago"
 */
export function formatRelativeTime(
  date: Date | string | number,
  options: { locale?: string; approximate?: boolean } = {}
): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Invalid date";

  const baseDate = new Date();
  const diffMs = baseDate.getTime() - d.getTime();
  const isPast = diffMs >= 0;

  // 小于 10 秒
  if (Math.abs(diffMs) < 10_000) {
    return isPast ? "刚刚" : "马上";
  }

  const result = formatDistanceToNow(d, {
    addSuffix: true,
    locale: getLocale(options.locale),
  });

  // formatDistanceToNow 返回 "约 3 小时前" 格式，已包含约数
  return result;
}

/**
 * 格式化日期范围为可读字符串
 *
 * @example
 * formatDateRange(new Date("2026-01-01"), new Date("2026-01-31"))
 * // "2026-01-01 ~ 2026-01-31"
 */
export function formatDateRange(
  start: Date | string | number,
  end: Date | string | number,
  locale?: string
): string {
  const s = typeof start === "string" || typeof start === "number" ? new Date(start) : start;
  const e = typeof end === "string" || typeof end === "number" ? new Date(end) : end;

  if (isNaN(s.getTime()) || isNaN(e.getTime())) return "Invalid date range";

  // 如果同一天，只显示一个日期
  if (differenceInCalendarDays(e, s) === 0) {
    return formatDate(s, { locale });
  }

  return `${formatDate(s, { locale })} ~ ${formatDate(e, { locale })}`;
}

/**
 * 检查日期是否在今天
 */
export { isToday };

/**
 * 检查日期是否在昨天
 */
export { isYesterday };

/**
 * 检查日期是否在本周
 */
export { isThisWeek };

/**
 * 获取友好的日期显示（智能选择格式）
 *
 * @example
 * getFriendlyDate(new Date())                 // "今天 14:30"
 * getFriendlyDate(yesterday)                  // "昨天 09:15"
 * getFriendlyDate(lastWeek)                   // "2026-07-12"
 * getFriendlyDate(lastYear)                   // "2025-07-19"
 */
export function getFriendlyDate(
  date: Date | string | number,
  locale?: string
): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Invalid date";

  if (isToday(d)) return `今天 ${format(d, "HH:mm")}`;
  if (isYesterday(d)) return `昨天 ${format(d, "HH:mm")}`;

  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return format(d, "M月d日");
  }

  return format(d, "yyyy年M月d日");
}

/**
 * 将日期转换为 ISO 字符串（本地时区）
 */
export function toLocalISOString(date: Date = new Date()): string {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 19);
}