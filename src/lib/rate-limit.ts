/**
 * 速率限制工具函数
 * 基于内存滑窗的 IP 级请求频率限制
 * 用于 API Routes 和 Server Actions 的防滥用保护
 *
 * 使用方式：
 *   const rateLimit = createRateLimit();
 *   const result = await rateLimit.check(request);
 *   if (!result.allowed) return Response.json({ error: "Too Many Requests" }, { status: 429 });
 */

import { RATE_LIMIT } from "@/lib/constants";

/** 速率限制检查结果 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

/** 请求追踪记录 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * 创建速率限制器实例
 * 每个实例独立维护内存中的请求计数 Map
 * 生产环境建议替换为 Redis 实现（如 @upstash/ratelimit 或 Vercel KV）
 */
export function createRateLimit(options?: {
  maxRequests?: number;
  windowMs?: number;
}) {
  const maxRequests = options?.maxRequests ?? RATE_LIMIT.maxRequests;
  const windowMs = options?.windowMs ?? RATE_LIMIT.windowMs;

  // 请求计数 Map（key: IP -> entry）
  const hits = new Map<string, RateLimitEntry>();

  // 每 60 秒清理过期条目，防止内存泄漏
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now >= entry.resetAt) {
        hits.delete(key);
      }
    }
  }, 60_000);

  // 允许在 Node.js 退出时清理定时器
  if (typeof process !== "undefined" && typeof process.on === "function") {
    process.on("exit", () => clearInterval(cleanupInterval));
  }

  return {
    /**
     * 检查当前请求是否在速率限制内
     * @param request - Next.js Request 对象
     * @returns RateLimitResult
     */
    async check(request: Request): Promise<RateLimitResult> {
      // 从请求头获取客户端 IP
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        request.headers.get("x-real-ip") ??
        "anonymous";

      const now = Date.now();
      let entry = hits.get(ip);

      // 没有记录或窗口已过期，创建新记录
      if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(ip, entry);
      }

      entry.count += 1;
      const remaining = Math.max(0, maxRequests - entry.count);
      const resetIn = Math.max(0, entry.resetAt - now);

      return {
        allowed: entry.count <= maxRequests,
        remaining,
        resetIn,
      };
    },

    /** 获取内部 Map 大小（用于监控） */
    size() {
      return hits.size;
    },

    /** 清理所有记录（用于测试） */
    clear() {
      hits.clear();
    },
  };
}

/** 单例导出，供全局复用 */
export const rateLimit = createRateLimit();
