/**
 * 速率限制工具函数（v0.5.0 D03 收口）
 * 统一的内存滑窗实现：IP 级请求限频与登录失败锁定共用同一个键控窗口存储。
 * 用于 API Routes 和 Server Actions 的防滥用保护。
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

/** 判断字符串是否形如合法 IP（IPv4 点分或含冒号的 IPv6） */
export function isIpLike(value: string): boolean {
  return /^[\d.]+$/.test(value) || value.includes(":");
}

/**
 * 从请求头提取客户端 IP（服务端 action 与 API 路由共用）：
 * 优先信任代理/边缘节点写入的 x-real-ip（客户端无法伪造）；
 * x-forwarded-for 仅在该值形如合法 IP（IPv4/IPv6）时采信，避免客户端伪造
 * 任意字符串或注入畸形值污染限流桶 key。
 */
export function clientIpFromHeaders(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return realIp ?? (forwarded && isIpLike(forwarded) ? forwarded : "anonymous");
}

function startCleanup(hits: Map<string, RateLimitEntry>): void {
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
}

/**
 * 创建键控滑窗存储（D03 统一收口）：IP 限频与登录失败锁定共用。
 * - hit：计数 +1 并判定是否放行
 * - peek：只读判定（不计数），供"查询是否已锁定"
 * - reset：清空该 key（如登录成功）
 */
export function createKeyedWindowStore(options: { max: number; windowMs: number }) {
  const { max, windowMs } = options;
  const hits = new Map<string, RateLimitEntry>();
  startCleanup(hits);

  return {
    hit(key: string): RateLimitResult {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return {
        allowed: entry.count <= max,
        remaining: Math.max(0, max - entry.count),
        resetIn: Math.max(0, entry.resetAt - now),
      };
    },

    peek(key: string): { allowed: boolean; resetIn: number } {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || now >= entry.resetAt) return { allowed: true, resetIn: 0 };
      if (entry.count < max) return { allowed: true, resetIn: 0 };
      return { allowed: false, resetIn: Math.max(0, entry.resetAt - now) };
    },

    reset(key: string): void {
      hits.delete(key);
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

/**
 * 创建速率限制器实例（IP 维度，基于键控滑窗存储）
 * 生产环境建议替换为 Redis 实现（如 @upstash/ratelimit 或 Vercel KV）
 */
export function createRateLimit(options?: { maxRequests?: number; windowMs?: number }) {
  const store = createKeyedWindowStore({
    max: options?.maxRequests ?? RATE_LIMIT.maxRequests,
    windowMs: options?.windowMs ?? RATE_LIMIT.windowMs,
  });

  return {
    /**
     * 检查当前请求是否在速率限制内
     * @param request - Next.js Request 对象
     * @returns RateLimitResult
     */
    async check(request: Request): Promise<RateLimitResult> {
      return store.hit(clientIpFromHeaders(request.headers));
    },

    size() {
      return store.size();
    },

    clear() {
      store.clear();
    },
  };
}

/** 单例导出，供全局复用 */
export const rateLimit = createRateLimit();
