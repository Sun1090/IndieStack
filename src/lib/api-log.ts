/**
 * API 路由错误日志（server-only，B09）
 * 统一附带 trace-id（middleware 注入的 x-request-id），生产经 logger 上报 Sentry。
 */
import { logger } from "@/lib/logger";
import { getTraceId } from "@/lib/trace";

/** 记录 API 错误，自动附带 traceId */
export async function logApiError(scope: string, error: unknown): Promise<void> {
  const traceId = await getTraceId();
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error(scope, traceId ? { traceId } : undefined, err);
}
