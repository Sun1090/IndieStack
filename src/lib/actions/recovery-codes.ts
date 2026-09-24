/**
 * MFA 备用恢复码服务端操作
 * 明文只在生成时返回一次；库中仅存 SHA-256 哈希。兑换成功即消费并解绑全部 TOTP
 * （Supabase 删 verified factor 会登出所有会话，调用方需引导用户重新登录）。
 */
"use server";

import { revalidatePath } from "next/cache";
// 注：node:crypto 必须动态导入——本模块被客户端组件引用，顶层静态导入会破坏
// Turbopack 客户端代理的导出分析，导致构建失败。
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";
import {
  generateRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "@/lib/validations/mfa";
import * as recoveryRepo from "@/lib/repositories/mfa-recovery-codes";
import { appendAuditLog } from "@/lib/repositories/audit-logs";
import { ROUTES } from "@/lib/constants";
import { logActionError } from "@/lib/api-log";

export async function hashRecoveryCode(code: string): Promise<string> {
  const { createHash } = await import("node:crypto");
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
    const { randomInt } = await import("node:crypto");
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      generateRecoveryCode((n) => randomInt(n)),
    );
    const hashes = await Promise.all(codes.map(hashRecoveryCode));
    await recoveryRepo.replaceRecoveryCodes(user.id, hashes);
    revalidatePath(ROUTES.dashboardSettings);
    return ok({ codes });
  } catch (error) {
    await logActionError("[generateRecoveryCodes] 生成失败", error);
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
    await logActionError("[hasRecoveryCodes] 查询失败", error);
    return fail("databaseError");
  }
}

/**
 * 解绑该用户的全部 TOTP 因子（删掉 verified factor 会登出所有会话）。
 * `listFactors()` / `deleteFactor()` 都走 Supabase Auth 管理端口：失败只出现在返回的 `error` 上，
 * 不抛异常——所以这里必须把它带回去，否则「一个因子都没解绑」会长成一次成功的自救。
 * 返回 null 表示成功；「本来就没有 TOTP 因子」是合法结果，不算失败。
 */
async function unbindTotpFactors(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<Error | null> {
  const listed = await admin.auth.admin.mfa.listFactors({ userId });
  if (listed.error) return new Error(listed.error.message);

  for (const factor of listed.data?.factors ?? []) {
    if (factor.factor_type !== "totp") continue;
    const deleted = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (deleted.error) return new Error(deleted.error.message);
  }
  return null;
}

/** 兑换恢复码：先解绑全部 TOTP 因子，成功后才消费这一条码（aal1 会话即可调用，用于登录挑战页自救） */
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
    const { timingSafeEqual } = await import("node:crypto");
    const targetHash = await hashRecoveryCode(normalized);
    const candidates = await recoveryRepo.listUnusedRecoveryCodes(user.id);
    const match = candidates.find((row) => {
      const a = Buffer.from(row.code_hash, "hex");
      const b = Buffer.from(targetHash, "hex");
      return a.length === b.length && timingSafeEqual(a, b);
    });
    if (!match) return fail("mfaInvalidCode");

    // 先解绑 TOTP，再扣恢复码。顺序反过来的话，一次解绑失败会同时留下两件坏事：
    // 恢复码已经用掉（不可逆），而把他锁在门外的验证器还在——而这个功能存在的理由正是
    // 「验证器丢了」。宁可让一次失败的兑换把码留着（可以重试），也不能报「已解绑」。
    const unbindFailure = await unbindTotpFactors(createAdminClient(), user.id);
    if (unbindFailure) {
      await logActionError("[redeemRecoveryCode] 解绑 TOTP 因子失败", unbindFailure);
      return fail("recoveryUnenrollFailed");
    }

    const consumed = await recoveryRepo.consumeRecoveryCode(match.id, user.id);
    if (!consumed) return fail("mfaInvalidCode");

    await appendAuditLog({
      userId: user.id,
      action: "auth.recovery_redeemed",
      entityType: "auth",
      entityId: user.id,
      metadata: {},
    });

    revalidatePath(ROUTES.login);
    return ok();
  } catch (error) {
    await logActionError("[redeemRecoveryCode] 兑换失败", error);
    return fail("databaseError");
  }
}
