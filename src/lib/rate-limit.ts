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

const IPV4_OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d?|\\d)";
const IPV4_PATTERN = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
const HEX_GROUP = /^[0-9a-fA-F]{1,4}$/;

/**
 * 判断字符串是否形如合法 IP：IPv4 点分十进制，或 IPv6（含 `::` 压缩与内嵌 IPv4 尾巴）。
 *
 * 判据按 `node:net` 的 `isIP()` 逐例对齐（见 `rate-limit.test.ts` 的差分用例），但不 import
 * `node:net`：本模块被 `@/lib/actions/*` 引用，而那些文件被客户端组件 import，带进 Node 内建模块
 * 会污染客户端图。唯一有意分歧是 IPv6 zone id（`fe80::1%eth0`）——代理不会把它写进转发头，
 * 而它进 `inet` 列的形态存疑，所以判否。
 */
export function isIpLike(value: string): boolean {
  if (IPV4_PATTERN.test(value)) return true;
  if (!value.includes(":")) return false;

  const halves = value.split("::");
  if (halves.length > 2) return false; // `::` 最多一次
  const groups = halves.map((half) => (half === "" ? [] : half.split(":"))).flat();

  let width = 0;
  for (const group of groups) {
    // 空段（首尾或中间的裸冒号，如 `:1:2…`）走到下面两条正则都不成立，所以不必单独判一次。
    if (IPV4_PATTERN.test(group)) width += 2; // 内嵌 IPv4 尾巴占两组
    else if (HEX_GROUP.test(group)) width += 1;
    else return false;
  }
  // `::` 必须至少压缩掉一组，所以压缩形态最多七组；未压缩时必须正好八组。
  return halves.length === 2 ? width <= 7 : width === 8;
}

/**
 * 从请求头提取客户端 IP（服务端 action 与 API 路由共用）：
 * 先看代理/边缘节点写的 x-real-ip，再退回 x-forwarded-for 的最左一段；**两支都要过
 * `isIpLike()` 这道形状闸门**，不合格就继续退回下一支，两支都不合格才是 `"anonymous"`。
 *
 * 为什么 x-real-ip 也要判：在 Vercel 上它由边缘节点写、客户端改不动，但直连部署（本地、容器、
 * 没配 `proxy_set_header X-Real-IP` 的反代）时它同样是客户端字符串——把形状闸门只装在回落支上，
 * `curl -H 'X-Real-IP: evil:'` 就能原样成为桶键。空串同理：`??` 只挡 `null`/`undefined`，
 * 一个被 trim 成空串的头会被当成一个合法身份。
 *
 * 闸门保证的是「key 一定是一个 IP 形状的字符串」，**不保证它是真的来源地址**：直连时任何人都能
 * 用 `X-Forwarded-For: 1.2.3.4`（换一个合法假 IP）换一个桶。要收紧就是改信任模型——取最右段、
 * 或要求显式配置受信代理跳数——那是按部署拓扑定的决定，不在这里顺手改（已钉成用例）。
 */
export function clientIpFromHeaders(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp && isIpLike(realIp)) return realIp;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded && isIpLike(forwarded) ? forwarded : "anonymous";
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
