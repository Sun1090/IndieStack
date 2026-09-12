/**
 * Passkey 注册选项（v0.5.0 D01 试点，ADR-012，feature flag 门控）
 * POST /api/auth/passkey/register-options —— 需登录；challenge 经 httpOnly cookie 下发
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { features } from "@/lib/feature-flags";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { createClient } from "@/lib/supabase/server";
import { listMyCredentials } from "@/lib/repositories/webauthn";
import { rpId, setChallengeCookie, siteUrl } from "@/lib/auth/passkey";
import { createRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const registerOptionsRateLimit = createRateLimit({ maxRequests: 10, windowMs: 60_000 });

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

  const existing = await listMyCredentials();
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
