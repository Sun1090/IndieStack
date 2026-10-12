/**
 * MFA 备用恢复码服务端操作
 * 明文只在生成时返回一次；库中仅存加盐 scrypt 派生值（历史行为未加盐的 SHA-256，
 * 见 `src/lib/auth/recovery-code-hash.ts` 的理由）。兑换成功即消费并解绑全部 TOTP
 * （Supabase 删 verified factor 会登出所有会话，调用方需引导用户重新登录）。
 */
"use server";

import { revalidatePath } from "next/cache";
// 注：node:crypto 必须动态导入——本模块被客户端组件引用，顶层静态导入会破坏
// Turbopack 客户端代理的导出分析，导致构建失败。
import {
  deriveRecoveryCodeHash,
  verifyRecoveryCodeHash,
} from "@/lib/auth/recovery-code-hash";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkActionRateLimit } from "@/lib/rate-limit";
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

/**
 * @deprecated 保留导出只为兼容既有调用点与用例。它现在返回的是 scrypt 编码，
 * **不再是 64 位十六进制的裸 SHA-256**——任何按「sha256 十六进制」假设使用返回值的地方
 * 都要改用 `verifyRecoveryCodeHash()`，不要在这里比对字符串。
 */
export async function hashRecoveryCode(code: string): Promise<string> {
  return deriveRecoveryCodeHash(code);
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
  const limits = await checkActionRateLimit();
  if (!limits.allowed) return fail("rateLimited");

  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return fail("mfaInvalidCode");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  try {
    const candidates = await recoveryRepo.listUnusedRecoveryCodes(user.id);
    // 逐张常量时间比对。这里**不能**先把明文哈希一次再比：新格式的盐是每行独立的，
    // 所以派生必须按每一行自己记录的 N/r/p/salt 来做。
    // 代价是验证时间随候选数线性增长（默认 10 张 ≈ 一次几百毫秒量级）；
    // 上限由 RECOVERY_CODE_COUNT 钉住，不是无界循环。
    let match: (typeof candidates)[number] | undefined;
    for (const row of candidates) {
      if (await verifyRecoveryCodeHash(normalized, row.code_hash)) {
        match = row;
        break;
      }
    }
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
