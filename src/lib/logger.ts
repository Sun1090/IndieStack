/**
 * 结构化日志工具
 * 提供统一的结构化日志记录能力，支持开发环境和 Sentry 集成
 *
 * @example
 * import { logger } from "@/lib/logger"
 * logger.info("用户登录成功", { userId: "abc123" })
 * logger.error("数据库查询失败", { error: err.message }, err)
 *
 * // 性能计时
 * const timer = logger.timer("数据库查询")
 * // ... 执行查询
 * timer.end() // 输出: "数据库查询: 235ms"
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
  error?: Error;
}

/** 是否为开发环境 */
const isDev = process.env.NODE_ENV === "development";

/** 是否启用详细日志 */
const isVerbose = process.env.NEXT_PUBLIC_VERBOSE_LOGGING === "true";

/** 日志记录器接口 */
interface Logger {
  debug: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>, error?: Error) => void;
  timer: (label: string) => { end: (data?: Record<string, unknown>) => void };
}

/**
 * 格式化日志输出
 */
function formatLog(entry: LogEntry): string {
  const { level, message, timestamp, data, error } = entry;
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const parts = [prefix, message];

  if (data && Object.keys(data).length > 0) {
    parts.push(JSON.stringify(data, null, isDev ? 2 : undefined));
  }

  if (error) {
    parts.push(error.stack ?? error.message);
  }

  return parts.join(" ");
}

/**
 * 实际的日志记录器
 */
function log(level: LogLevel, message: string, data?: Record<string, unknown>, error?: Error) {
  const entry: LogEntry = { level, message, timestamp: new Date().toISOString(), data, error };

  if (isDev || isVerbose) {
    const formatted = formatLog(entry);
    switch (level) {
      case "debug":
        console.debug(formatted);
        break;
      case "info":
        console.info(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      case "error":
        console.error(formatted);
        break;
    }
  }

  // 生产环境错误上报 Sentry
  if (level === "error" && !isDev && typeof process !== "undefined") {
    try {
      const Sentry = require("@sentry/nextjs");
      Sentry.captureException(error ?? new Error(message), {
        extra: { ...data, logLevel: level },
      });
    } catch {
      // Sentry 未配置时静默处理
    }
  }
}

/**
 * 结构化日志 API
 */
export const logger: Logger = {
  debug: (message: string, data?: Record<string, unknown>) => log("debug", message, data),
  info: (message: string, data?: Record<string, unknown>) => log("info", message, data),
  warn: (message: string, data?: Record<string, unknown>) => log("warn", message, data),
  error: (message: string, data?: Record<string, unknown>, error?: Error) =>
    log("error", message, data, error),

  /**
   * 性能计时器
   */
  timer: (label: string) => {
    const start = performance.now();
    return {
      end: (data?: Record<string, unknown>) => {
        const duration = performance.now() - start;
        log("info", `${label}: ${Math.round(duration)}ms`, {
          ...data,
          durationMs: Math.round(duration),
        });
      },
    };
  },
};
