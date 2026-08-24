/**
 * 请求级链路追踪
 * middleware 为每个请求生成 x-request-id；此助手在 Server Actions /
 * Route Handlers 中读取，用于把日志与请求关联起来。
 */
import { headers } from "next/headers";

/** 当前请求的 trace-id（无 middleware 上下文时返回 null） */
export async function getTraceId(): Promise<string | null> {
  try {
    return (await headers()).get("x-request-id");
  } catch {
    // 非请求上下文（如构建期/脚本）
    return null;
  }
}
