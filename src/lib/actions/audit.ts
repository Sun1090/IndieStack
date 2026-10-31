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
import { AUTH_AUDIT_ACTIONS } from "@/lib/auth/audit-actions";

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
 * 允许写入的审计动作**清单**在 `src/lib/auth/audit-actions.ts`（普通模块），
 * 判定仍在这里——`logAuthEvent` 是**匿名**可用的 action（失败登录时还没有会话），
 * 而 `audit_logs.action` 是一个 text 列，调用方能写进任意字符串就等于
 * 让攻击者决定「审计里出现哪些事件类型」。
 *
 * 清单为什么搬走：它曾经是这里的 `export const AUTH_AUDIT_ACTIONS = [...]`，
 * 而 `"use server"` 文件只允许导出 async 函数——一个常量数组就让整个模块求值失败，
 * 并**连带废掉同一 actions loader 里的登录 action**，登录页整体不可用。
 * 本地 lint / tsc / 单测 / `next build` 全不报，只有 E2E 真的点一次登录才红。
 * 这条约束目前**没有本地门禁**（代价：只能靠 E2E 兜）——补一条 `check:use-server-exports`
 * 是台账里写明的下一手，而不是已经做到的事。
 */

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
