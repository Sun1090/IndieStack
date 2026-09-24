/**
 * 营销 token 端点的请求边界（v0.12.0 C10）
 *
 * `/api/marketing/confirm` 与 `/api/marketing/unsubscribe` 是全站仅有的两条
 * 「匿名、命中即写库」的路由。token 本身不是弱点：48 位十六进制（≈192 bit）、按 sha256 查、
 * 长度上下界与有效期都卡着。弱点是**没有配额**——任何人都能不限速地反复打一次会写数据库的公开入口。
 *
 * 阈值与 passkey 的匿名入口同档（10 次 / 分钟 / IP）。两个端点共用一只桶：它们是同一个滥用面，
 * 各起一只等于把阈值放宽一倍。
 * 放在模块里而不是各自 `createRateLimit()`，是为了让这只桶可被测试复位——
 * 用例之间互相吃掉配额，就会变成一条只在跑满次数时才红的顺序依赖 flake。
 */
import type { NextResponse } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { createRateLimit } from "@/lib/rate-limit";

export const MARKETING_TOKEN_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };

const marketingTokenLimit = createRateLimit(MARKETING_TOKEN_RATE_LIMIT);

/** 测试/运维：清空计数桶（与 `clearLoginBuckets()` 同形状） */
export function clearMarketingTokenBucket(): void {
  marketingTokenLimit.clear();
}

/** 超限返回 429（带 `Retry-After`）；未超限返回 null，调用方照常往下走。 */
export async function marketingTokenRateGuard(
  request: Request,
): Promise<NextResponse | null> {
  const limits = await marketingTokenLimit.check(request);
  if (limits.allowed) return null;
  const retryAfter = Math.ceil(limits.resetIn / 1000);
  return jsonNoStore(
    { error: "Too Many Requests", retryAfter },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
