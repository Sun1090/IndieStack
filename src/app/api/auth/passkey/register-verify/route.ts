/**
 * Passkey 注册验证（v0.5.0 D01 试点，ADR-012，feature flag 门控）
 * POST /api/auth/passkey/register-verify —— 校验 attestation 并落库凭据
 */

import { NextRequest, NextResponse } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { features } from "@/lib/feature-flags";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { createClient } from "@/lib/supabase/server";
import { createCredential } from "@/lib/repositories/webauthn";
import {
  clearChallengeCookie,
  expectedOrigin,
  readChallengeCookie,
  rpId,
} from "@/lib/auth/passkey";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!features.passkey) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonNoStore({ error: "Unauthorized" }, { status: 401 });

  const challenge = readChallengeCookie(request);
  if (!challenge) return jsonNoStore({ error: "Challenge expired" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as
    | { response?: { deviceName?: string } & Record<string, unknown> }
    | null;
  if (!body?.response) return jsonNoStore({ error: "Invalid body" }, { status: 400 });
  const { deviceName, ...attestation } = body.response;

  try {
    const verification = await verifyRegistrationResponse({
      response: attestation as never,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigin(),
      expectedRPID: rpId(),
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return jsonNoStore({ error: "Verification failed" }, { status: 400 });
    }

    const { credential } = verification.registrationInfo;
    await createCredential({
      userId: user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      deviceName: typeof deviceName === "string" ? deviceName : null,
      transports: credential.transports ?? null,
    });

    return clearChallengeCookie(NextResponse.json({ verified: true }));
  } catch (error) {
    console.error("[passkey register-verify] 校验失败:", error);
    return jsonNoStore({ error: "Verification failed" }, { status: 400 });
  }
}
