/**
 * 请求级链路追踪
 * middleware（`src/proxy.ts`）为每个请求生成 `x-request-id`；此助手在 Server Actions /
 * Route Handlers / Server Components 中读取，用于把日志与请求关联起来。
 *
 * ID 的合法性判定与生成逻辑在 `@/lib/trace-id`（纯模块，可被 Edge middleware 复用），
 * 这里只负责从 Next 请求上下文读取。
 */
import { headers } from "next/headers";
import { TRACE_HEADER } from "@/lib/trace-id";

export {
  TRACE_HEADER,
  MAX_TRACE_ID_LENGTH,
  normalizeTraceId,
  createTraceId,
  resolveTraceId,
} from "@/lib/trace-id";

/** 当前请求的 trace-id（无 middleware 上下文时返回 null） */
export async function getTraceId(): Promise<string | null> {
  try {
    return (await headers()).get(TRACE_HEADER);
  } catch {
    // 非请求上下文（如构建期/脚本）
    return null;
  }
}
