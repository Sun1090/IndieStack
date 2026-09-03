/**
 * 双因素认证（TOTP）服务端操作
 * 基于 Supabase MFA API；客户端完成 challengeAndVerify 后会话即升级为 aal2
 */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeTotpCode } from "@/lib/validations/mfa";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";

export interface MfaFactor {
  id: string;
  status: string;
  createdAt?: string;
}

/** 列出当前用户的 TOTP 因子 */
export async function listTotpFactors(): Promise<ActionResult<MfaFactor[]>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    console.error("[listTotpFactors] 查询失败:", error.message);
    return fail("databaseError");
  }
  return ok(
    data.totp.map((f: { id: string; status: string; created_at?: string }) => ({
      id: f.id,
      status: f.status,
      createdAt: f.created_at,
    })),
  );
}

/** 开始注册 TOTP：返回 QR 码（SVG data URL）与密钥 */
export async function enrollTotp(): Promise<
  ActionResult<{ factorId: string; qrCode: string; secret: string }>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `indiestack-${new Date().toISOString().slice(0, 10)}`,
  });

  if (error || !data) {
    console.error("[enrollTotp] 注册失败:", error?.message);
    return fail("mfaEnrollFailed");
  }

  return ok({
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  });
}

/** 验证码确认，完成注册 */
export async function verifyTotpEnrollment(
  factorId: string,
  code: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  const cleaned = normalizeTotpCode(code);
  if (!cleaned) return fail("mfaInvalidCode");

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: cleaned });

  if (error) {
    console.error("[verifyTotpEnrollment] 验证失败:", error.message);
    return fail(error.message.includes("Invalid") ? "mfaInvalidCode" : "databaseError");
  }

  revalidatePath("/dashboard/settings");
  return ok();
}

/** 解除 TOTP（需提供当前验证码二次确认） */
export async function unenrollTotp(
  factorId: string,
  code: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  const cleaned = normalizeTotpCode(code);
  if (!cleaned) return fail("mfaInvalidCode");

  // 先用验证码做一次 challenge 校验身份，再解除
  const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: cleaned,
  });
  if (verifyError) return fail("mfaInvalidCode");

  const { error } = await supabase.auth.mfa.unenroll(factorId);

  if (error) {
    console.error("[unenrollTotp] 解除失败:", error.message);
    return fail("databaseError");
  }

  revalidatePath("/dashboard/settings");
  return ok();
}
