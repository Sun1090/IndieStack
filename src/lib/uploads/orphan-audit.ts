/**
 * 存储孤儿巡检的纯逻辑（A10 收尾）
 *
 * `033` 提供了 `find_orphan_upload_objects()`，`src/lib/uploads/erasure.ts` 也写明
 * provider 删除失败的行「仍可被 `find_orphan_upload_objects()` /
 * `pnpm audit:storage-orphans` 发现并补删」——但那当时只是一句承诺：既没有命令，
 * 也没有任何人会去跑它。本模块补上这条链路的可复用部分：把 RPC 的原始行解析成
 * 结构化结果、按「是否还认得主人」汇总，并产出人和脚本都能读的报告。
 *
 * 汇总刻意把 **owner_id 为空** 的行单列：那表示上传者账户已经删除，而对象还在
 * bucket 里公开可读。这是隐私面而不是容量问题，所以它排在总字节数前面。
 *
 * 边界（写在这里，不要靠猜）：RPC 的真相来源是 `upload_objects`，因此只能发现
 * 「有元数据行、无业务引用」的对象。031 之前直接写入 bucket、从未落过元数据的
 * 存量对象不在清单里，需要 provider 侧 `list()` 与数据库做集合差才能发现。
 */

/** PostgREST RPC 名；与迁移签名和 service-role 边界清单一致。 */
export const ORPHAN_AUDIT_RPC = "find_orphan_upload_objects";

/** RPC 每行必须出现的列（`033` 的 returns table 定义）。 */
export const ORPHAN_ROW_COLUMNS = ["bucket", "object_key", "owner_id", "byte_size", "created_at"] as const;

export interface OrphanObjectRow {
  bucket: string;
  objectKey: string;
  /** `null` 表示上传者账户已删除——这条正是需要优先补删的。 */
  ownerId: string | null;
  byteSize: number;
  createdAt: string;
}

export interface OrphanSummary {
  count: number;
  totalBytes: number;
  /** 账户已删除、仍留在 bucket 里的对象数。 */
  unowned: number;
  unownedBytes: number;
  /** 按 bucket 汇总，字节数降序。 */
  byBucket: Array<{ bucket: string; count: number; bytes: number }>;
  /** 最老一条的天数；无数据时为 null。 */
  oldestDays: number | null;
}

/** 解析失败时抛出；调用方据此以「错误」而不是「零孤儿」退出。 */
export class OrphanAuditError extends Error {}

function requireText(row: Record<string, unknown>, column: string, index: number): string {
  const value = row[column];
  if (typeof value !== "string" || value === "") {
    throw new OrphanAuditError(`第 ${index + 1} 行缺少 ${column}`);
  }
  return value;
}

/**
 * 校验并转换 RPC 返回值。
 *
 * 严格解析而不是 `as` 断言：`byte_size` 由 PostgREST 以 bigint 序列化，可能是数字
 * 也可能是字符串；缺列或类型漂移说明数据库与代码不同步（迁移没应用、或 RPC 被改过），
 * 这种情况必须让巡检失败，而不是静默把「读不懂」报成「没有孤儿」。
 */
export function parseOrphanRows(payload: unknown): OrphanObjectRow[] {
  if (!Array.isArray(payload)) {
    throw new OrphanAuditError(`期望数组，实际得到 ${payload === null ? "null" : typeof payload}`);
  }
  return payload.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new OrphanAuditError(`第 ${index + 1} 行不是对象`);
    }
    const row = entry as Record<string, unknown>;
    const byteSize = Number(row.byte_size ?? 0);
    if (!Number.isFinite(byteSize) || byteSize < 0) {
      throw new OrphanAuditError(`第 ${index + 1} 行 byte_size 非法：${String(row.byte_size)}`);
    }
    const ownerId = row.owner_id;
    if (ownerId !== null && ownerId !== undefined && typeof ownerId !== "string") {
      throw new OrphanAuditError(`第 ${index + 1} 行 owner_id 类型非法`);
    }
    return {
      bucket: requireText(row, "bucket", index),
      objectKey: requireText(row, "object_key", index),
      ownerId: typeof ownerId === "string" ? ownerId : null,
      byteSize,
      createdAt: requireText(row, "created_at", index),
    };
  });
}

function daysSince(iso: string, nowMs: number): number | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((nowMs - at) / 86_400_000));
}

/** 汇总孤儿清单。`nowMs` 由调用方注入，保证可重复测试。 */
export function summarizeOrphans(rows: readonly OrphanObjectRow[], nowMs: number): OrphanSummary {
  const byBucket = new Map<string, { count: number; bytes: number }>();
  let totalBytes = 0;
  let unowned = 0;
  let unownedBytes = 0;
  let oldestDays: number | null = null;

  for (const row of rows) {
    totalBytes += row.byteSize;
    if (row.ownerId === null) {
      unowned += 1;
      unownedBytes += row.byteSize;
    }
    const group = byBucket.get(row.bucket) ?? { count: 0, bytes: 0 };
    group.count += 1;
    group.bytes += row.byteSize;
    byBucket.set(row.bucket, group);

    const age = daysSince(row.createdAt, nowMs);
    if (age !== null) oldestDays = oldestDays === null ? age : Math.max(oldestDays, age);
  }

  return {
    count: rows.length,
    totalBytes,
    unowned,
    unownedBytes,
    byBucket: [...byBucket.entries()]
      .map(([bucket, group]) => ({ bucket, count: group.count, bytes: group.bytes }))
      .sort((a, b) => b.bytes - a.bytes || a.bucket.localeCompare(b.bucket)),
    oldestDays,
  };
}

/** 人类可读的字节数；不追求单位换算的精确性，只用于快速判断量级。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i]!;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

export interface OrphanReportOptions {
  nowMs: number;
  /** 报告里最多列出多少条明细（超出部分给出省略提示）。 */
  maxRows?: number;
}

/** 生成文本报告。零孤儿时也要有可核对的输出，便于事后归档证据。 */
export function formatOrphanReport(
  rows: readonly OrphanObjectRow[],
  summary: OrphanSummary,
  options: OrphanReportOptions,
): string[] {
  const limit = options.maxRows ?? 50;
  const lines: string[] = [];
  lines.push(
    `孤儿对象：${summary.count} 条，共 ${formatBytes(summary.totalBytes)}` +
      (summary.count === 0
        ? ""
        : `；其中 ${summary.unowned} 条上传者账户已删除（${formatBytes(summary.unownedBytes)}）`),
  );
  if (summary.oldestDays !== null) lines.push(`最老一条已存在 ${summary.oldestDays} 天`);
  for (const group of summary.byBucket) {
    lines.push(`  bucket ${group.bucket}: ${group.count} 条 / ${formatBytes(group.bytes)}`);
  }
  const shown = rows.slice(0, limit);
  for (const row of shown) {
    const age = daysSince(row.createdAt, options.nowMs);
    lines.push(
      `  - ${row.bucket}/${row.objectKey}  ${formatBytes(row.byteSize)}` +
        `  ${age === null ? "时间不可解析" : `${age} 天`}` +
        `  ${row.ownerId === null ? "账户已删除" : `owner=${row.ownerId}`}`,
    );
  }
  if (rows.length > shown.length) {
    lines.push(`  …另有 ${rows.length - shown.length} 条，用 --json 拿完整清单`);
  }
  if (summary.count === 0) {
    lines.push("  （数据库侧无遗漏；031 之前从未落元数据的对象需 provider 侧 list() 差集）");
  }
  return lines;
}

/** 巡检的退出码约定：0 无孤儿 / 1 执行失败 / 2 有孤儿且要求失败退出。 */
export const ORPHAN_EXIT_CODES = { clean: 0, error: 1, findings: 2 } as const;

export function decideOrphanExitCode(summary: OrphanSummary, failOnFindings: boolean): number {
  if (summary.count > 0 && failOnFindings) return ORPHAN_EXIT_CODES.findings;
  return ORPHAN_EXIT_CODES.clean;
}
