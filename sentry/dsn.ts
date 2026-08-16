/**
 * Sentry DSN 解析与校验
 *
 * 占位 DSN（如 https://your-dsn@sentry.io/your-project）会被 Sentry SDK
 * 判为无效并打印 `Invalid Sentry Dsn` 警告。此处统一校验：
 *  - project id 必须是纯数字（Sentry 的 project id 恒为数字）
 *  - 不包含占位标记（your-dsn / your-project 等）
 * 返回 undefined 表示未配置或无效，调用方应完全禁用 Sentry。
 */
const PLACEHOLDER_MARKERS = [
  "your-dsn",
  "your-project",
  "your-sentry",
  "your-org",
  "example.com",
];

export function getSentryDsn(): string | undefined {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return undefined;

  try {
    const url = new URL(dsn);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;

    // Sentry project id 必须是数字（占位符通常为 your-project）
    const projectId = url.pathname.replace(/^\/+/, "");
    if (!/^\d+$/.test(projectId)) return undefined;

    // host / 完整 DSN 中出现占位标记则视为未配置
    if (PLACEHOLDER_MARKERS.some((marker) => dsn.includes(marker))) {
      return undefined;
    }

    return dsn;
  } catch {
    return undefined;
  }
}

export const isSentryEnabled = (): boolean => !!getSentryDsn();
