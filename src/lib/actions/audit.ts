/**
 * 审计事件服务端操作（C04 登录审计）
 * 登录成功/失败/MFA/恢复码兑换统一落 audit_logs；审计写入永不抛错阻断主流程。
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import { checkActionRateLimit } from "@/lib/rate-limit";
import { appendAuditLog } from "@/lib/repositories/audit-logs";
import { logActionError } from "@/lib/api-log";
import { isRetryableSessionReadFailure } from "@/lib/auth/session-error";

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
        isSensitiveMetadataKey(key) ? REDACTED_VALUE : redactAuditMetadataValue(nestedValue, seen),
      );
    }
    return Object.fromEntries(redacted);
  }

  return value;
}

function redactAuthAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactAuditMetadataValue(metadata) as Record<string, unknown>;
}

/**
 * 允许写入的审计动作**清单**（运行时事实源）。
 *
 * 这份常量不是给类型用的装饰：`logAuthEvent` 是**匿名**可用的 action（失败登录时还没有会话），
 * 参数在反序列化之后只剩一个字符串，而 `audit_logs.action` 是一个 text 列——
 * 没有任何东西阻止调用方写进任意字符串。后果不是提权，是**取证面被污染**：
 * 审计读者按 `action` 过滤与聚合（`listAuditLogsPage`、后台筛选），
 * 一个能随便写 action 的入口等于让攻击者决定「审计里出现哪些事件类型」。
 * 同一条入口还能自报 `metadata.email`，也就是替任意邮箱伪造一条 `auth.login_failed`。
 *
 * 所以类型从常量派生（单一事实源），判定在运行时。
 */
export const AUTH_AUDIT_ACTIONS = [
  "auth.login",
  "auth.login_failed",
  "auth.oauth_login",
  "auth.passkey_login",
  "auth.mfa_verified",
  "auth.recovery_redeemed",
] as const;

export type AuthAuditAction = (typeof AUTH_AUDIT_ACTIONS)[number];

/** `metadata` 的序列化上限：审计表是永久保留、只追加的，不能由匿名调用方决定写多大。 */
const AUDIT_METADATA_MAX_BYTES = 4096;

function isPlainMetadata(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * 记录认证审计事件。失败登录允许无会话（user_id 置空，仅记邮箱）。
 * 限频：防攻击者刷失败登录灌爆审计表。
 * 入参校验：`action` 必须在清单内、`metadata` 必须是普通对象且不超过 4KB——
 * 越界一律**静默丢弃**（审计写入永不阻断主流程），但会在服务端日志里留一条，
 * 免得「审计悄悄没写」变成一个没人知道的空洞。
 */
export async function logAuthEvent(
  action: string,
  metadata: Record<string, unknown> = {},
): Promise<{ ok: true }> {
  try {
    if (!(AUTH_AUDIT_ACTIONS as readonly string[]).includes(action)) {
      await logActionError("[logAuthEvent] 拒绝未登记的动作", new Error(String(action).slice(0, 80)));
      return { ok: true };
    }

    if (!isPlainMetadata(metadata)) {
      await logActionError("[logAuthEvent] 拒绝非对象 metadata", new Error(typeof metadata));
      return { ok: true };
    }

    const limits = await checkActionRateLimit();
    if (!limits.allowed) return { ok: true };

    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    const redacted = redactAuthAuditMetadata(
      isRetryableSessionReadFailure(error) ? { ...metadata, sessionReadFailed: true } : metadata,
    );

    // 截断检查放在 redact 之后：真正落库的是 redacted，之前的体积没有意义。
    if (new TextEncoder().encode(JSON.stringify(redacted)).length > AUDIT_METADATA_MAX_BYTES) {
      await logActionError("[logAuthEvent] 拒绝超长 metadata", new Error("metadata_too_large"));
      return { ok: true };
    }

    await appendAuditLog({
      userId: data.user?.id ?? null,
      action,
      entityType: "auth",
      entityId: data.user?.id ?? null,
      // 「没读到会话」和「本来就没有会话」（失败登录时还没有 session）在 `user_id` 这一列上
      // 长得一模一样，而对审计读者这是两件相反的事：前者是取证链断了一截。用 metadata 标出来——
      // 不加列、不动迁移，审计表是既有的 append-only 面。
      // 注意**不能按「`error` 非空」来标**：Auth 客户端给匿名访客返回的就是一个
      // `AuthSessionMissingError`，那样标出来的会是「每一次失败登录」，而不是它要抓的那一类故障。
      metadata: redacted,
    });
  } catch (error) {
    await logActionError("[logAuthEvent] 审计写入失败", error);
  }
  return { ok: true };
}
