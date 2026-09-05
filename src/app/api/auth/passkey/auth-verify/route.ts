/**
 * Passkey 认证验证（v0.5.0 D01 试点，ADR-012，feature flag 门控）
 * POST /api/auth/passkey/auth-verify —— 校验 assertion、更新计数器（克隆检测）。
 * 试点范围说明：会话签发仍由 Supabase Auth 承担（尚无 passkey 登录通道），
 * 本端点验证凭据有效性并返回 userId，供后续接入完整登录流。
 */

import { NextRequest, NextResponse } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { features } from "@/lib/feature-flags";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import {
  findCredentialById,
  updateCredentialCounter,
} from "@/lib/repositories/webauthn";
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

  const challenge = readChallengeCookie(request);
  if (!challenge) return jsonNoStore({ error: "Challenge expired" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as
    | { response?: { id?: string } & Record<string, unknown> }
    | null;
  const credentialId = body?.response?.id;
  if (!body?.response || typeof credentialId !== "string") {
    return jsonNoStore({ error: "Invalid body" }, { status: 400 });
  }

  const credential = await findCredentialById(credentialId);
  if (!credential) return jsonNoStore({ error: "Credential not found" }, { status: 404 });

  try {
    const verification = await verifyAuthenticationResponse({
      response: body.response as never,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigin(),
      expectedRPID: rpId(),
      requireUserVerification: false,
      credential: {
        id: credential.credential_id,
        publicKey: Buffer.from(credential.public_key, "base64url"),
        counter: credential.counter,
        transports: (credential.transports as never) ?? undefined,
      },
    });

    if (!verification.verified) {
      return jsonNoStore({ error: "Verification failed" }, { status: 400 });
    }

    await updateCredentialCounter(credential.credential_id, verification.authenticationInfo.newCounter);
    return clearChallengeCookie(NextResponse.json({ verified: true, userId: credential.user_id }));
  } catch (error) {
    console.error("[passkey auth-verify] 校验失败:", error);
    return jsonNoStore({ error: "Verification failed" }, { status: 400 });
  }
}
