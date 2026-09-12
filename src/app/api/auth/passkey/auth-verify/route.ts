/**
 * Passkey 认证验证（v0.5.0 D01，ADR-012，feature flag 门控）
 * POST /api/auth/passkey/auth-verify —— 校验 assertion、更新计数器，并签发 Supabase 会话。
 *
 * 安全边界：
 * - assertion 必须验签成功后才触发生成一次性 magiclink token；
 * - token 仅在服务端消费，响应只返回登录结果，不暴露 token、邮箱或 userId；
 * - challenge cookie 每次验证尝试后立即清除，避免浏览器重放；
 * - MFA 用户仍返回 factorId，要求完成 aal2 后才进入受保护页面。
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
import { establishPasskeySession } from "@/lib/auth/passkey-session";
import { createRateLimit } from "@/lib/rate-limit";
import { logApiError } from "@/lib/api-log";

export const dynamic = "force-dynamic";

const authVerifyRateLimit = createRateLimit({ maxRequests: 10, windowMs: 60_000 });

type AuthenticationResponse = { id?: string } & Record<string, unknown>;

function credentialIdFromBody(body: unknown): string | null {
  const response = (body as { response?: AuthenticationResponse } | null)?.response;
  return response && typeof response.id === "string" ? response.id : null;
}

function clearChallenge(response: NextResponse): NextResponse {
  return clearChallengeCookie(response);
}

async function verifyAssertion(
  response: AuthenticationResponse,
  challenge: string,
  credential: Awaited<ReturnType<typeof findCredentialById>> & {},
): Promise<number | null> {
  try {
    const verification = await verifyAuthenticationResponse({
      response: response as never,
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

    if (!verification.verified) return null;
    return verification.authenticationInfo.newCounter;
  } catch (error) {
    await logApiError("[passkey auth-verify] assertion verification failed", error);
    return null;
  }
}

async function persistCounter(credentialId: string, counter: number): Promise<boolean> {
  try {
    await updateCredentialCounter(credentialId, counter);
    return true;
  } catch (error) {
    await logApiError("[passkey auth-verify] counter update failed", error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!features.passkey || !features.passkeyLogin) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
  }

  const limits = await authVerifyRateLimit.check(request);
  if (!limits.allowed) {
    return jsonNoStore(
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limits.resetIn / 1000)) },
      },
    );
  }

  const challenge = readChallengeCookie(request);
  if (!challenge) return jsonNoStore({ error: "Challenge expired" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as {
    response?: AuthenticationResponse;
  } | null;
  const credentialId = credentialIdFromBody(body);
  if (!body?.response || !credentialId) {
    return clearChallenge(jsonNoStore({ error: "Invalid body" }, { status: 400 }));
  }

  const credential = await findCredentialById(credentialId);
  if (!credential) {
    return clearChallenge(jsonNoStore({ error: "Credential not found" }, { status: 404 }));
  }

  const newCounter = await verifyAssertion(body.response, challenge, credential);
  if (newCounter === null) {
    return clearChallenge(jsonNoStore({ error: "Verification failed" }, { status: 400 }));
  }

  if (!(await persistCounter(credential.credential_id, newCounter))) {
    return clearChallenge(jsonNoStore({ error: "Authentication unavailable" }, { status: 503 }));
  }

  try {
    const session = await establishPasskeySession(credential.user_id);
    const payload = session.mfaRequired
      ? { verified: true, mfaRequired: true, factorId: session.factorId }
      : { verified: true, mfaRequired: false };
    return clearChallenge(jsonNoStore(payload));
  } catch (error) {
    await logApiError("[passkey auth-verify] session bridge failed", error);
    return clearChallenge(jsonNoStore({ error: "Authentication unavailable" }, { status: 503 }));
  }
}
