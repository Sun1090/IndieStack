/**
 * Passkey 注册选项（v0.5.0 D01 试点，ADR-012，feature flag 门控）
 * POST /api/auth/passkey/register-options —— 需登录；challenge 经 httpOnly cookie 下发
 */

import { NextResponse } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { features } from "@/lib/feature-flags";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { createClient } from "@/lib/supabase/server";
import { listMyCredentials } from "@/lib/repositories/webauthn";
import { rpId, setChallengeCookie, siteUrl } from "@/lib/auth/passkey";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!features.passkey) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
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

  return setChallengeCookie(NextResponse.json(options), options.challenge);
}
