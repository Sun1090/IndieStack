/**
 * Passkey → Supabase Auth 会话桥接（ADR-012）
 *
 * GoTrue 尚无原生 passkey 登录通道。Assertion 已由服务端验证后，才使用
 * service_role 为该用户生成一次性 magiclink token，并在同一个请求内立即消费。
 * token、action_link 与邮箱 OTP 永不返回浏览器，也不写入日志；最终只下发
 * Supabase SSR 会话 cookie。
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Factor } from "@supabase/supabase-js";

type AdminClient = ReturnType<typeof createAdminClient>;
type ServerClient = Awaited<ReturnType<typeof createClient>>;

export interface PasskeySession {
  mfaRequired: boolean;
  factorId: string | null;
}

export class PasskeySessionError extends Error {
  constructor() {
    super("Passkey session bridge failed");
    this.name = "PasskeySessionError";
  }
}

async function getAccountEmail(admin: AdminClient, userId: string): Promise<string> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  const email = data?.user?.email;

  if (error || !email) throw new PasskeySessionError();
  return email;
}

async function createMagicLinkTokenHash(
  admin: AdminClient,
  userId: string,
  email: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const properties = data?.properties;

  if (error) throw new PasskeySessionError();
  if (!properties?.hashed_token || properties.verification_type !== "magiclink") {
    throw new PasskeySessionError();
  }
  if (data?.user?.id !== userId) throw new PasskeySessionError();

  return properties.hashed_token;
}

async function consumeMagicLink(
  supabase: ServerClient,
  userId: string,
  tokenHash: string,
): Promise<Factor[]> {
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });

  if (!error && data.session && data.user?.id === userId) {
    return (data.user.factors as Factor[] | undefined) ?? [];
  }

  if (data.session) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
  throw new PasskeySessionError();
}

/**
 * 为已经通过 WebAuthn assertion 校验的用户签发 Supabase 会话。
 * 调用方必须先确认 credential.user_id 与 userId 一致。
 */
export async function establishPasskeySession(userId: string): Promise<PasskeySession> {
  try {
    const admin = createAdminClient();
    const email = await getAccountEmail(admin, userId);
    const tokenHash = await createMagicLinkTokenHash(admin, userId, email);

    // createClient() 的 cookie adapter 会由 @supabase/ssr 自动写入 Set-Cookie。
    const supabase = await createClient();
    const factors = await consumeMagicLink(supabase, userId, tokenHash);
    const verifiedFactor = factors.find((factor) => factor.status === "verified");
    return {
      mfaRequired: Boolean(verifiedFactor),
      factorId: verifiedFactor?.id ?? null,
    };
  } catch (error) {
    if (error instanceof PasskeySessionError) throw error;
    // 不记录原始错误：GoTrue 错误对象可能携带 action_link / token 字段。
    throw new PasskeySessionError();
  }
}
