/**
 * 数据保留与账户擦除契约（v0.6.0 H08）
 *
 * 隐私声明（`messages/<locale>/privacy.json`）承诺删除账户后会在 30 天内删除或匿名化个人数据，
 * 而账户删除此前只依赖外键级联：`api_usage` 与 `audit_logs` 是 `on delete set null`
 * （行留下、`ip_address` 与 `metadata` 里的个人数据也留下），`contact_messages` 根本没有
 * 外键（按裸邮箱存储，删号完全覆盖不到）。同时 `api_usage` 与 `upload_objects` 的
 * `deleted` 元数据行没有任何保留期，会无界增长。
 *
 * 迁移 `032_data_retention_erasure.sql` 落地这些边界，本模块是它取值
 * （保留天数、pg_cron 任务名与调度、被擦除的数据面、审计 metadata 的 PII 键、
 * 删除确认短语）的单一事实来源：调用点只引用这里的常量，
 * `data-policy.test.ts` 再把常量与迁移 SQL、`docs/db/retention.md` 双向钉死。
 * 文档写 90 天而 SQL 删 91 天前的数据这类漂移会直接失败，而不是等到值班按文档排查。
 */

/** 一条「按时间窗批量删除」的保留策略，对应迁移里的一个清理函数 + 一个 pg_cron 任务。 */
export interface RetentionPolicy {
  /** 被清理的表（含 schema）。 */
  table: string;
  /** 迁移里定义的 `security definer` 清理函数名。 */
  cleanupFunction: string;
  /** pg_cron 任务名；重放迁移是更新同名任务，不新增任务。 */
  cronJob: string;
  /** pg_cron 调度表达式（UTC）。 */
  schedule: string;
  /** 保留天数；清理条件恒为「早于 now() - retentionDays」。 */
  retentionDays: number;
  /** 时间窗使用的列。 */
  column: string;
  /** 定义该清理函数的迁移；调度与撤权可能落在后续迁移里（如 014 调度、028 撤权）。 */
  migration: string;
  /**
   * 额外的行过滤条件（SQL 片段）。用于「只清理某几个状态」的策略——
   * 未处理/待重试的行代表尚未交付的用户请求，删除即静默丢消息，因此永不清理。
   */
  statusPredicate?: string;
}

/**
 * 全部 SQL 侧保留策略。
 *
 * 调度依赖 pg_cron：迁移用 `if exists (select 1 from pg_extension ...)` 守卫，
 * 未安装扩展的环境（含当前云端项目）会跳过调度，此时保留期**并不生效**，
 * 需要运维在 Supabase Dashboard 启用扩展后重放调度。`docs/db/retention.md` 记录了这一点。
 */
export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  {
    table: "public.notifications",
    cleanupFunction: "cleanup_old_notifications",
    cronJob: "cleanup-old-notifications",
    schedule: "0 4 * * 0",
    retentionDays: 90,
    column: "created_at",
    migration: "003_projects_notifications_indexes.sql",
    statusPredicate: "is_read = true",
  },
  {
    table: "public.webhook_events",
    cleanupFunction: "cleanup_old_webhook_events",
    cronJob: "cleanup-old-webhook-events",
    schedule: "0 4 * * 0",
    retentionDays: 90,
    column: "created_at",
    migration: "014_retention_cleanup.sql",
  },
  {
    table: "public.email_worker_runs",
    cleanupFunction: "cleanup_old_email_worker_runs",
    cronJob: "cleanup-old-email-worker-runs",
    schedule: "15 4 * * 0",
    retentionDays: 90,
    column: "created_at",
    migration: "027_email_worker_runs_retention.sql",
  },
  {
    table: "public.api_usage",
    cleanupFunction: "cleanup_old_api_usage",
    cronJob: "cleanup-old-api-usage",
    schedule: "30 4 * * 0",
    retentionDays: 90,
    column: "created_at",
    migration: "032_data_retention_erasure.sql",
  },
  {
    table: "public.upload_objects",
    cleanupFunction: "prune_deleted_upload_objects",
    cronJob: "prune-deleted-upload-objects",
    schedule: "45 4 * * 0",
    retentionDays: 30,
    column: "updated_at",
    migration: "032_data_retention_erasure.sql",
    statusPredicate: "status = 'deleted'",
  },
  {
    table: "public.contact_messages",
    cleanupFunction: "cleanup_resolved_contact_messages",
    cronJob: "cleanup-resolved-contact-messages",
    schedule: "0 5 * * 0",
    retentionDays: 365,
    column: "created_at",
    migration: "032_data_retention_erasure.sql",
    statusPredicate: "status = 'resolved'",
  },
];

/** 账户删除时同步调用的擦除 RPC（`security definer`，仅 service_role 可执行）。 */
export const ACCOUNT_ERASURE_RPC = "erase_user_data";

/** 擦除 RPC 的入参名，与迁移签名 `erase_user_data(p_user_id uuid)` 一致。 */
export const ACCOUNT_ERASURE_ARG = "p_user_id";

/** 擦除覆盖的数据面；与迁移体内的三段删除/匿名化一一对应。 */
export const ACCOUNT_ERASURE_TARGETS = [
  "api_usage",
  "contact_messages",
  "audit_logs",
] as const;

/**
 * 擦除结果里各数据面的受影响行数。
 *
 * `audit_logs` 是「匿名化」而不是删除：合规要求保留行为事实
 * （`action` / `entity_type` / `created_at`），因此单独命名为 `Anonymized`，
 * 避免文档与指标把它读成「审计日志被删了」。
 */
export interface AccountErasureCounts {
  apiUsage: number;
  contactMessages: number;
  auditLogsAnonymized: number;
}

/** RPC 返回的计数键；`parseAccountErasureCounts` 要求恰好这些键。 */
export const ACCOUNT_ERASURE_COUNT_KEYS = [
  "apiUsage",
  "contactMessages",
  "auditLogsAnonymized",
] as const;

/**
 * `audit_logs.metadata` 中需要剔除的键。
 *
 * 审计行里的 `email` / `ip_address` / `user_agent` 是 002 的用法示例本身教出来的写法
 * （`log_audit_action('team.invite', 'team', id, '{"email": ...}')`），
 * 只把 `user_id` 置 null 并不足以切断与个人的连接。
 */
export const AUDIT_PII_METADATA_KEYS = [
  "email",
  "ip",
  "ip_address",
  "user_agent",
  "phone",
  "full_name",
  "avatar_url",
  "token",
] as const;

/**
 * 账户删除的确认短语，按界面语言取其一。
 *
 * 服务端只接受这两个字面量（大小写不敏感），而 `danger.confirmPhrase` 文案必须
 * 原样包含对应短语，否则用户照提示输入却永远无法删除——测试把两边钉在一起。
 */
export const ACCOUNT_DELETION_CONFIRM_PHRASES = ["delete", "删除"] as const;

/** 与全部语言无关的归一化：去空白、转小写，供服务端比较确认短语。 */
export function normalizeAccountDeletionPhrase(input: unknown): string {
  return typeof input === "string" ? input.trim().toLowerCase() : "";
}

/** 确认短语是否匹配任一语言的期望值。 */
export function isAccountDeletionConfirmed(input: unknown): boolean {
  const value = normalizeAccountDeletionPhrase(input);
  return ACCOUNT_DELETION_CONFIRM_PHRASES.some((phrase) => phrase === value);
}

/**
 * 校验擦除 RPC 的返回值。
 *
 * 账户删除是不可逆操作，因此返回值形状不符时抛错而不是宽容地返回 0：
 * 调用方据此中止后续的 `deleteUser`，避免出现「以为擦了其实没擦」的静默泄露。
 */
export function parseAccountErasureCounts(value: unknown): AccountErasureCounts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("erase_user_data returned an unexpected shape");
  }
  const record = value as Record<string, unknown>;
  const missing = ACCOUNT_ERASURE_COUNT_KEYS.filter(
    (key) => typeof record[key] !== "number" || !Number.isFinite(record[key]) || (record[key] as number) < 0,
  );
  if (missing.length > 0) {
    throw new Error(`erase_user_data response is missing counts: ${missing.join(", ")}`);
  }
  return {
    apiUsage: record.apiUsage as number,
    contactMessages: record.contactMessages as number,
    auditLogsAnonymized: record.auditLogsAnonymized as number,
  };
}
