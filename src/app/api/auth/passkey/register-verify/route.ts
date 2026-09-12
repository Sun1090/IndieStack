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
import { createRateLimit } from "@/lib/rate-limit";
import { logApiError } from "@/lib/api-log";

export const dynamic = "force-dynamic";

const registerVerifyRateLimit = createRateLimit({ maxRequests: 10, windowMs: 60_000 });

interface RegistrationCredential {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[] | null;
}

function clearChallenge(response: NextResponse): NextResponse {
  return clearChallengeCookie(response);
}

async function verifyAttestation(
  attestation: Record<string, unknown>,
  challenge: string,
): Promise<RegistrationCredential | null> {
  try {
    const verification = await verifyRegistrationResponse({
      response: attestation as never,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigin(),
      expectedRPID: rpId(),
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) return null;
    const { credential } = verification.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports ?? null,
    };
  } catch (error) {
    await logApiError("[passkey register-verify] attestation verification failed", error);
    return null;
  }
}

async function persistCredential(
  userId: string,
  credential: RegistrationCredential,
  deviceName: string | null,
): Promise<boolean> {
  try {
    await createCredential({ userId, ...credential, deviceName });
    return true;
  } catch (error) {
    await logApiError("[passkey register-verify] credential persistence failed", error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!features.passkey) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
  }

  const limits = await registerVerifyRateLimit.check(request);
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

  const challenge = readChallengeCookie(request);
  if (!challenge) return jsonNoStore({ error: "Challenge expired" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as
    | { response?: { deviceName?: string } & Record<string, unknown> }
    | null;
  if (!body?.response) {
    return clearChallenge(jsonNoStore({ error: "Invalid body" }, { status: 400 }));
  }
  const { deviceName, ...attestation } = body.response;

  const credential = await verifyAttestation(attestation, challenge);
  if (!credential) {
    return clearChallenge(jsonNoStore({ error: "Verification failed" }, { status: 400 }));
  }

  const persisted = await persistCredential(
    user.id,
    credential,
    typeof deviceName === "string" ? deviceName : null,
  );
  if (!persisted) {
    return clearChallenge(
      jsonNoStore({ error: "Authentication unavailable" }, { status: 503 }),
    );
  }

  return clearChallenge(jsonNoStore({ verified: true }));
}
