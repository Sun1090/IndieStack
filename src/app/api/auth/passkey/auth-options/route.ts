/**
 * Passkey 认证选项（v0.5.0 D01 试点，ADR-012，feature flag 门控）
 * POST /api/auth/passkey/auth-options —— 无需登录（discoverable credential 解锁设备）；
 * challenge 经 httpOnly cookie 下发。
 */

import { NextResponse } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { features } from "@/lib/feature-flags";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { rpId, setChallengeCookie } from "@/lib/auth/passkey";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!features.passkey) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
  }

  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    userVerification: "preferred",
    // 空 allowCredentials：允许 discoverable credential（passkey）自动选择账户
    allowCredentials: [],
  });

  return setChallengeCookie(NextResponse.json(options), options.challenge);
}
