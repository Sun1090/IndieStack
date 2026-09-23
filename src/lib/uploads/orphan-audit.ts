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
 * 消费方有两个：`pnpm audit:storage-orphans`（按需取完整清单），以及
 * `/api/cron/retention` 每天顺带的只读巡检——后者只用 `summarizeOrphans` 的
 * `count` / `unowned` 两个数产指标，不落清单。
 *
 * 边界（写在这里，不要靠猜）：RPC 的真相来源是 `upload_objects`，因此只能发现
 * 「有元数据行、无业务引用」的对象。031 之前直接写入 bucket、从未落过元数据的
 * 存量对象不在清单里——那半边由本文件末尾的 provider 侧列目录差集（C05）补上，
 * 它是**按需开启**的第二条链路，因为要走完整个 bucket。
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
    lines.push(
      "  （数据库侧无遗漏；这只说明「有元数据行、无业务引用」的集合为空——" +
        "从未落过元数据的对象要加 --provider-diff 列目录才知道）",
    );
  }
  return lines;
}

/**
 * 巡检的退出码约定：0 无孤儿 / 1 执行失败 / 2 有孤儿且要求失败退出。
 *
 * `extraFindings` 是给 provider 集合差留的口子：那类发现（无元数据行、active 行对象已消失）
 * 同样应该让 `--fail-on-findings` 变红，但它们的修法完全不同（要么补登记要么人工确认），
 * 所以只并到同一个退出码上，不混进 `OrphanSummary` 的孤儿计数里。
 */
export const ORPHAN_EXIT_CODES = { clean: 0, error: 1, findings: 2 } as const;

export function decideOrphanExitCode(
  summary: OrphanSummary,
  failOnFindings: boolean,
  extraFindings = 0,
): number {
  if ((summary.count > 0 || extraFindings > 0) && failOnFindings) {
    return ORPHAN_EXIT_CODES.findings;
  }
  return ORPHAN_EXIT_CODES.clean;
}

// ============================================================
// provider 侧集合差（C05）
// ============================================================

/**
 * `POST /storage/v1/object/list/<bucket>` 返回的一条目。
 *
 * 实测（本地栈 2026-09-23）：文件夹是 `{name:"probe", id:null, metadata:null}`，
 * 对象是 `{name:"x.txt", id:"<uuid>", updated_at:"…", metadata:{size:12, …}}`。
 * `name` 相对于请求里的 `prefix`，所以完整键要自己拼。
 */
export interface StorageListEntry {
  name: string;
  /** `null` 表示这是个文件夹而不是对象。 */
  id: string | null;
  updatedAt: string | null;
  /** `metadata.size`；文件夹与缺元数据的条目为 `null`。 */
  bytes: number | null;
}

/** provider 侧真实存在的一个对象。 */
export interface ProviderObject {
  bucket: string;
  objectKey: string;
  bytes: number | null;
  updatedAt: string | null;
}

/** `upload_objects` 里的一行元数据。 */
export interface TrackedObject {
  bucket: string;
  objectKey: string;
  status: "active" | "deleted";
}

/** 从一条列目录结果的 `metadata.size` 取字节数；形状不认识就抛。 */
function readEntryBytes(metadata: unknown, where: string): number | null {
  if (metadata === null || metadata === undefined) return null;
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new OrphanAuditError(`${where} 的 metadata 类型非法`);
  }
  const size = (metadata as Record<string, unknown>).size;
  if (size === undefined || size === null) return null;
  const parsed = Number(size);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new OrphanAuditError(`${where} 的 metadata.size 非法：${String(size)}`);
  }
  return parsed;
}

/** 解析列目录里的一个条目；`where` 只为了让报错能指出是哪一页的第几条。 */
function parseStorageListEntry(entry: unknown, where: string): StorageListEntry {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new OrphanAuditError(`${where} 不是对象`);
  }
  const row = entry as Record<string, unknown>;
  if (typeof row.name !== "string" || row.name === "") {
    throw new OrphanAuditError(`${where} 缺少 name`);
  }
  const id = row.id;
  if (id !== null && id !== undefined && typeof id !== "string") {
    throw new OrphanAuditError(`${where} 的 id 类型非法`);
  }
  return {
    name: row.name,
    id: typeof id === "string" ? id : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    bytes: readEntryBytes(row.metadata, where),
  };
}

/** 解析一页列目录结果。形状不认识就抛，不猜。 */
export function parseStorageListPage(payload: unknown, prefix: string): StorageListEntry[] {
  if (!Array.isArray(payload)) {
    throw new OrphanAuditError(
      `列目录 ${prefix || "<根>"} 期望数组，实际得到 ${payload === null ? "null" : typeof payload}`,
    );
  }
  return payload.map((entry, index) => parseStorageListEntry(entry, `${prefix || "<根>"} 第 ${index + 1} 条`));
}

/** 列目录的开销上限；触顶即「清单不完整」而不是「清单为空」。 */
export interface BucketWalkLimits {
  pageSize: number;
  maxPages: number;
  maxDepth: number;
  maxObjects: number;
}

export const DEFAULT_BUCKET_WALK_LIMITS: BucketWalkLimits = {
  pageSize: 500,
  maxPages: 200,
  maxDepth: 6,
  maxObjects: 50_000,
};

export interface BucketWalkResult {
  bucket: string;
  objects: ProviderObject[];
  /** 实际发出的列目录请求数。 */
  pages: number;
  folders: number;
  /** `false` = 撞到上限，清单不完整。调用方必须按失败处理。 */
  complete: boolean;
  stoppedAt: string | null;
}

/**
 * 递归列完一个 bucket。
 *
 * 分页终止条件是「这一页没满」，但**只有在上限之内**成立：页数/深度/条数任一触顶都记成
 * 不完整，因为「我们没看完」和「bucket 里没有东西」是两个必须分开的结论——一个报绿的
 * 巡检把前者说成后者，就等于把盲区洗成了清白。
 */
export async function walkProviderBucket(input: {
  bucket: string;
  listPage: (prefix: string, offset: number) => Promise<unknown>;
  limits?: Partial<BucketWalkLimits>;
}): Promise<BucketWalkResult> {
  const limits: BucketWalkLimits = { ...DEFAULT_BUCKET_WALK_LIMITS, ...(input.limits ?? {}) };
  const objects: ProviderObject[] = [];
  const seen = new Set<string>();
  let pages = 0;
  let folders = 0;
  let complete = true;
  let stoppedAt: string | null = null;

  const queue: Array<{ prefix: string; depth: number }> = [{ prefix: "", depth: 0 }];
  while (queue.length > 0) {
    const { prefix, depth } = queue.shift()!;
    if (depth > limits.maxDepth) {
      complete = false;
      stoppedAt = stoppedAt ?? `${input.bucket}/${prefix}<深度上限 ${limits.maxDepth}>`;
      continue;
    }
    let offset = 0;
    for (;;) {
      if (pages >= limits.maxPages) {
        complete = false;
        stoppedAt = stoppedAt ?? `${input.bucket}/${prefix}<页数上限 ${limits.maxPages}>`;
        return { bucket: input.bucket, objects, pages, folders, complete, stoppedAt };
      }
      const entries = parseStorageListPage(await input.listPage(prefix, offset), prefix);
      pages += 1;
      for (const entry of entries) {
        if (entry.id === null) {
          folders += 1;
          queue.push({ prefix: `${prefix}${entry.name}/`, depth: depth + 1 });
          continue;
        }
        const objectKey = `${prefix}${entry.name}`;
        const identity = objectIdentity(input.bucket, objectKey);
        if (seen.has(identity)) continue;
        seen.add(identity);
        objects.push({
          bucket: input.bucket,
          objectKey,
          bytes: entry.bytes,
          updatedAt: entry.updatedAt,
        });
        if (objects.length >= limits.maxObjects) {
          complete = false;
          stoppedAt = stoppedAt ?? `${input.bucket}/${objectKey}<条数上限 ${limits.maxObjects}>`;
          return { bucket: input.bucket, objects, pages, folders, complete, stoppedAt };
        }
      }
      if (entries.length < limits.pageSize) break;
      offset += limits.pageSize;
    }
  }

  return { bucket: input.bucket, objects, pages, folders, complete, stoppedAt };
}

export function objectIdentity(bucket: string, objectKey: string): string {
  return `${bucket}/${objectKey}`;
}

/** provider 与数据库两个方向的差集。 */
export interface ProviderDiff {
  bucket: string;
  providerCount: number;
  /** 元数据表里指向该 bucket 的行数（active + deleted）。 */
  trackedCount: number;
  /** bucket 里有对象、元数据表完全不认得——031 之前的存量就是这一类。 */
  untracked: ProviderObject[];
  /** 元数据说是 `active`，bucket 里却没有这个对象。 */
  vanished: string[];
  scannedPages: number;
  folders: number;
  complete: boolean;
  stoppedAt: string | null;
}

/**
 * 做集合差。
 *
 * `vanished` 只判 `active` 行：`deleted` 行是「我们已经承认它没了」，
 * 而 `active` 行是一张还挂着的公共 URL——对象没了就意味着链接已经死了。
 */
export function diffProviderObjects(
  walked: BucketWalkResult,
  tracked: readonly TrackedObject[],
): ProviderDiff {
  const trackedHere = tracked.filter((row) => row.bucket === walked.bucket);
  const trackedIdentities = new Set(
    trackedHere.map((row) => objectIdentity(row.bucket, row.objectKey)),
  );
  const providerIdentities = new Set(walked.objects.map((object) => objectIdentity(object.bucket, object.objectKey)));

  return {
    bucket: walked.bucket,
    providerCount: walked.objects.length,
    trackedCount: trackedHere.length,
    untracked: walked.objects.filter(
      (object) => !trackedIdentities.has(objectIdentity(object.bucket, object.objectKey)),
    ),
    vanished: trackedHere
      .filter(
        (row) =>
          row.status === "active" && !providerIdentities.has(objectIdentity(row.bucket, row.objectKey)),
      )
      .map((row) => objectIdentity(row.bucket, row.objectKey)),
    scannedPages: walked.pages,
    folders: walked.folders,
    complete: walked.complete,
    stoppedAt: walked.stoppedAt,
  };
}

/** 差集里有发现吗（用于退出码）。 */
export function providerDiffFindings(diff: ProviderDiff): number {
  return diff.untracked.length + diff.vanished.length;
}

/** provider 差集那一段报告；只在巡检真的列过目录时调用。 */
export function formatProviderDiffLines(diff: ProviderDiff, maxRows = 50): string[] {
  const lines: string[] = [
    `provider 集合差（bucket ${diff.bucket}）：列了 ${diff.providerCount} 个对象 / ` +
      `${diff.trackedCount} 行元数据，用 ${diff.scannedPages} 页、${diff.folders} 个文件夹`,
    `  - 无元数据行（031 之前的存量或删除失败的残留）：${diff.untracked.length} 个`,
    `  - 元数据为 active 但对象已不在 bucket：${diff.vanished.length} 个`,
  ];
  for (const object of diff.untracked.slice(0, maxRows)) {
    lines.push(
      `    · ${objectIdentity(object.bucket, object.objectKey)}` +
        `${object.bytes === null ? "" : `  ${formatBytes(object.bytes)}`}`,
    );
  }
  if (diff.untracked.length > maxRows) {
    lines.push(`    …另有 ${diff.untracked.length - maxRows} 个，用 --json 拿完整清单`);
  }
  for (const key of diff.vanished.slice(0, maxRows)) {
    lines.push(`    · ${key}`);
  }
  if (diff.vanished.length > maxRows) {
    lines.push(`    …另有 ${diff.vanished.length - maxRows} 个，用 --json 拿完整清单`);
  }
  return lines;
}
