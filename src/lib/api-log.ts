/**
 * 服务端错误日志边界（B09 / E02）
 * Route Handler 与 Server Action 都通过这里记录异常，统一附带 trace-id
 * （middleware 注入的 x-request-id），生产经 logger 上报 Sentry。
 *
 * 分成两个入口只是为了让调用点自解释；两者共用同一实现与同一规则码，
 * 避免「路由带 trace、action 不带 trace」这类漂移。
 */
import { logger } from "@/lib/logger";
import { getTraceId } from "@/lib/trace";

async function logErrorWithTrace(scope: string, error: unknown): Promise<void> {
  const traceId = await getTraceId();
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error(scope, traceId ? { traceId } : undefined, err);
}

/** 记录 Route Handler 错误，自动附带 traceId */
export async function logApiError(scope: string, error: unknown): Promise<void> {
  await logErrorWithTrace(scope, error);
}

/** 记录 Server Action（及由其触发的后台写入）错误，自动附带 traceId */
export async function logActionError(scope: string, error: unknown): Promise<void> {
  await logErrorWithTrace(scope, error);
}
