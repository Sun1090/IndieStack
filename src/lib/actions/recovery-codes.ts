/**
 * MFA 备用恢复码服务端操作
 * 明文只在生成时返回一次；库中仅存 SHA-256 哈希。兑换成功即消费并解绑全部 TOTP
 * （Supabase 删 verified factor 会登出所有会话，调用方需引导用户重新登录）。
 */
"use server";

import { randomInt, createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";
import {
  generateRecoveryCode,
  normalizeRecoveryCode,
} from "@/lib/validations/mfa";
import * as recoveryRepo from "@/lib/repositories/mfa-recovery-codes";
import { appendAuditLog } from "@/lib/repositories/audit-logs";
import { ROUTES } from "@/lib/constants";

/** 每次生成的恢复码数量 */
export const RECOVERY_CODE_COUNT = 10;

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.replace(/-/g, "")).digest("hex");
}

/** 生成一组新的恢复码（覆盖旧码），明文仅本次返回 */
export async function generateRecoveryCodes(): Promise<ActionResult<{ codes: string[] }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  try {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      generateRecoveryCode((n) => randomInt(n)),
    );
    await recoveryRepo.replaceRecoveryCodes(user.id, codes.map(hashRecoveryCode));
    revalidatePath(ROUTES.dashboardSettings);
    return ok({ codes });
  } catch (error) {
    console.error("[generateRecoveryCodes] 生成失败:", error);
    return fail("databaseError");
  }
}

/** 是否有可用恢复码（设置页提示用） */
export async function hasRecoveryCodes(): Promise<ActionResult<{ has: boolean }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  try {
    return ok({ has: await recoveryRepo.hasUnusedRecoveryCodes(user.id) });
  } catch (error) {
    console.error("[hasRecoveryCodes] 查询失败:", error);
    return fail("databaseError");
  }
}

/** 兑换恢复码：消费并解绑全部 TOTP 因子（aal1 会话即可调用，用于登录挑战页自救） */
export async function redeemRecoveryCode(code: string): Promise<ActionResult> {
  const limits = await rateLimit.check(new Request("http://local/redeem"));
  if (!limits.allowed) return fail("rateLimited");

  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return fail("mfaInvalidCode");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  try {
    const targetHash = hashRecoveryCode(normalized);
    const candidates = await recoveryRepo.listUnusedRecoveryCodes(user.id);
    const match = candidates.find((row) => {
      const a = Buffer.from(row.code_hash, "hex");
      const b = Buffer.from(targetHash, "hex");
      return a.length === b.length && timingSafeEqual(a, b);
    });
    if (!match) return fail("mfaInvalidCode");

    const consumed = await recoveryRepo.consumeRecoveryCode(match.id, user.id);
    if (!consumed) return fail("mfaInvalidCode");

    // 先记审计（随后解绑会登出所有会话）
    await appendAuditLog({
      userId: user.id,
      action: "auth.recovery_redeemed",
      entityType: "auth",
      entityId: user.id,
      metadata: {},
    });

    // 解绑该用户全部 TOTP 因子；删 verified factor 会登出所有会话，前端引导重新登录
    const admin = createAdminClient();
    const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
    for (const factor of factors?.factors ?? []) {
      if (factor.factor_type === "totp") {
        await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.id });
      }
    }

    revalidatePath(ROUTES.login);
    return ok();
  } catch (error) {
    console.error("[redeemRecoveryCode] 兑换失败:", error);
    return fail("databaseError");
  }
}
