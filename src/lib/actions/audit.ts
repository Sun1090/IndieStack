/**
 * 审计事件服务端操作（C04 登录审计）
 * 登录成功/失败/MFA/恢复码兑换统一落 audit_logs；审计写入永不抛错阻断主流程。
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { appendAuditLog } from "@/lib/repositories/audit-logs";

const REDACTED_VALUE = "[REDACTED]";

/**
 * Removes credentials and other authentication secrets before audit metadata is
 * handed to the repository. Audit records are durable, so this boundary must
 * remain safe even when a future caller accidentally passes a sensitive field.
 */
function isSensitiveMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return /(?:^|_)(?:password|passcode|token|secret|code|authorization|cookie)(?:$|_)/.test(
    normalized,
  );
}

function redactAuditMetadataValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditMetadataValue(item, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) return REDACTED_VALUE;
    seen.add(value);

    const redacted = new Map<string, unknown>();
    for (const [key, nestedValue] of Object.entries(value)) {
      redacted.set(
        key,
        isSensitiveMetadataKey(key)
          ? REDACTED_VALUE
          : redactAuditMetadataValue(nestedValue, seen),
      );
    }
    return Object.fromEntries(redacted);
  }

  return value;
}

function redactAuthAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactAuditMetadataValue(metadata) as Record<string, unknown>;
}

export type AuthAuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.oauth_login"
  | "auth.passkey_login"
  | "auth.mfa_verified"
  | "auth.recovery_redeemed";

/**
 * 记录认证审计事件。失败登录允许无会话（user_id 置空，仅记邮箱）。
 * 限频：防攻击者刷失败登录灌爆审计表。
 */
export async function logAuthEvent(
  action: AuthAuditAction,
  metadata: Record<string, unknown> = {},
): Promise<{ ok: true }> {
  try {
    const limits = await rateLimit.check(new Request("http://local/audit"));
    if (!limits.allowed) return { ok: true };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await appendAuditLog({
      userId: user?.id ?? null,
      action,
      entityType: "auth",
      entityId: user?.id ?? null,
      metadata: redactAuthAuditMetadata(metadata),
    });
  } catch (error) {
    console.error("[logAuthEvent] 审计写入失败:", error);
  }
  return { ok: true };
}
