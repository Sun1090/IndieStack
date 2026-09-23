/**
 * Passkey 注册选项（v0.5.0 D01 试点，ADR-012，feature flag 门控）
 * POST /api/auth/passkey/register-options —— 需登录；challenge 经 httpOnly cookie 下发；
 * 已登记凭据读不到时返回 503，不把故障答成「你还没有 passkey」
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { features } from "@/lib/feature-flags";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { createClient } from "@/lib/supabase/server";
import { listMyCredentials } from "@/lib/repositories/webauthn";
import { rpId, setChallengeCookie, siteUrl } from "@/lib/auth/passkey";
import { createRateLimit } from "@/lib/rate-limit";
import { logApiError } from "@/lib/api-log";

export const dynamic = "force-dynamic";

const registerOptionsRateLimit = createRateLimit({ maxRequests: 10, windowMs: 60_000 });

/**
 * 读该用户已登记的凭据，用来填 `excludeCredentials`（就是用来挡住「同一台设备再登记一份」的）。
 * 读不到时返回 `undefined` 而不是空数组：空数组说的是「这个人还没有 passkey」，
 * 那是结论，不是「我们没问出来」——按它继续就会把一次数据库故障答成一次正常的登记。
 */
async function listExistingCredentials() {
  try {
    return await listMyCredentials();
  } catch (error) {
    await logApiError("[passkey register-options] credential list failed", error);
    return undefined;
  }
}

export async function POST(request: NextRequest) {
  if (!features.passkey) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
  }

  const limits = await registerOptionsRateLimit.check(request);
  if (!limits.allowed) {
    const retryAfter = Math.ceil(limits.resetIn / 1000);
    return jsonNoStore(
      { error: "Too Many Requests", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonNoStore({ error: "Unauthorized" }, { status: 401 });

  const existing = await listExistingCredentials();
  if (existing === undefined) {
    return jsonNoStore({ error: "Authentication unavailable" }, { status: 503 });
  }
  const options = await generateRegistrationOptions({
    rpName: "IndieStack",
    rpID: rpId(),
    userID: new TextEncoder().encode(user.id),
    userName: user.email ?? user.id,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: (c.transports as never) ?? undefined })),
  });

  return setChallengeCookie(jsonNoStore(options), options.challenge);
}
