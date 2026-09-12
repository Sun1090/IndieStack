/**
 * Passkey 认证选项（v0.5.0 D01，ADR-012，feature flag 门控）
 * POST /api/auth/passkey/auth-options —— 无需登录（discoverable credential 解锁设备）；
 * challenge 经 httpOnly cookie 下发。
 */

import { NextRequest, NextResponse } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { features } from "@/lib/feature-flags";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { rpId, setChallengeCookie } from "@/lib/auth/passkey";
import { createRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const authOptionsRateLimit = createRateLimit({ maxRequests: 10, windowMs: 60_000 });

export async function POST(request: NextRequest) {
  if (!features.passkey || !features.passkeyLogin) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
  }

  const limits = await authOptionsRateLimit.check(request);
  if (!limits.allowed) {
    return jsonNoStore(
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limits.resetIn / 1000)) },
      },
    );
  }

  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    userVerification: "preferred",
    // 空 allowCredentials：允许 discoverable credential（passkey）自动选择账户
    allowCredentials: [],
  });

  return setChallengeCookie(jsonNoStore(options), options.challenge);
}
