/**
 * 「把一条迁移经 Management API 应用到云端」的判定层——IO 在 `scripts/lib/migration-apply-cli.js`。
 *
 * 起因：2026-10-24 台账记录的已知操作负担——用 `POST /database/query` 应用迁移时，
 * 之前的手工流程是「执行迁移体 + 手工 INSERT 一行迁移历史」，而那行历史的
 * `version` 落的是 14 位时间戳形态，与 manifest 的 3 位序号不匹配，
 * 判定层把它读成「本地不认识的迁移」，每次都要人工订正（034 / 035 各一次，
 * 订正本身已于同日固化为 `ops:migration-status --fix-version-shape`）。
 *
 * 本模块把整条流程变成可判定的计划，并从根上消掉那个坑：
 *   - **先校验再执行**：目标版本必须在 manifest 里登记、文件 SHA-256 必须与
 *     manifest 一致（与 `check:migrations` 同一把尺）——「本地文件和登记的不一样」
 *     时执行它等于应用了一条没人审计过的 SQL；
 *   - **迁移历史用序号形状落库**：`version` 取 manifest 序号、`name` 取文件名
 *     （去 `.sql`），与 supabase CLI 落的形状一致——形状坑不再产生，
 *     `--fix-version-shape` 只用来清历史遗留；
 *   - **已 applied 的版本拒绝重放**：迁移文件不是幂等的白名单清单，
 *     `create table` 这类语句重放必然报错甚至重复写数据，所以执行前先问云端。
 *
 * 三条设计约束与 `migration-status.ts` 同源：读不到实况就退出码 2（未知不算通过）、
 * 不做形状假设（版本号一律经 `normalizeMigrationVersion` 比较）、
 * 计划与执行共用同一出处（判定层生成 SQL 文本，IO 层只负责发）。
 */

import { createHash } from "node:crypto";
import type { ManifestMigrationEntry } from "./migration-status";

export type { ManifestMigrationEntry };

export interface MigrationApplyPlan {
  /** manifest 序号，也是迁移历史行的 `version`。 */
  version: string;
  /** 迁移文件名（含 `.sql`），也是迁移历史行的 `name` 来源。 */
  fileName: string;
  /** manifest 登记的 SHA-256，已与实际文件内容核对一致。 */
  sha256: string;
  /** 要执行的第一条 SQL：迁移文件原文，一字不改。 */
  applySql: string;
  /** 要执行的第二条 SQL：用序号形状插入迁移历史。 */
  historyInsertSql: string;
}

export type MigrationApplyBlockCode =
  | "APPLY_VERSION_NOT_IN_MANIFEST"
  | "APPLY_FILE_UNREADABLE"
  | "APPLY_SHA_MISMATCH"
  | "APPLY_ALREADY_APPLIED";

export interface MigrationApplyBlock {
  code: MigrationApplyBlockCode;
  message: string;
}

export function migrationSha256(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/** SQL 文本字面量转义：单引号翻倍。历史插入是唯一做字符串拼接的地方。 */
export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * 组装迁移历史 INSERT。`statements` 存单元素数组（整个文件原文）：
 * CLI 落的也是「按语句拆开」，但本流程不重放它——它只做证据，
 * 拆错边界反而破坏证据，原文入列最忠实。
 */
export function buildHistoryInsertSql(version: string, fileName: string, sql: string): string {
  const name = fileName.replace(/\.sql$/i, "");
  return (
    "insert into supabase_migrations.schema_migrations (version, name, statements) values (" +
    `${sqlLiteral(version)}, ${sqlLiteral(name)}, array[${sqlLiteral(sql)}]::text[]);`
  );
}

/**
 * 判断目标版本是否已在云端 applied（按归一化版本号比较，形状无关）。
 * `applied` 传 null（= 没读到云端）时返回 false 并由调用方按「未知」处理——
 * 这里不区分「没应用」和「读不到」，后者不该放行重放。
 */
export function isVersionApplied(
  version: string,
  applied: ReadonlyArray<{ raw: string; version: string | null }> | null,
  normalize: (raw: string) => string | null,
): boolean {
  if (applied === null) return false;
  const key = normalize(version);
  if (key === null) return false;
  return applied.some((entry) => entry.version !== null && entry.version === key);
}

/**
 * 组装完整应用计划；任何不满足的前提都以 `MigrationApplyBlock` 返回，
 * 由 IO 层打印并退出码 2——**校验失败的路径不存在「部分执行」**。
 */
export function buildMigrationApplyPlan(input: {
  version: string;
  manifestEntries: ManifestMigrationEntry[];
  fileText: string | null;
  applied: ReadonlyArray<{ raw: string; version: string | null }> | null;
  normalize: (raw: string) => string | null;
}): { plan: MigrationApplyPlan } | { block: MigrationApplyBlock } {
  const entry = input.manifestEntries.find(
    (candidate) => input.normalize(candidate.version) === input.normalize(input.version),
  );
  if (!entry) {
    return {
      block: {
        code: "APPLY_VERSION_NOT_IN_MANIFEST",
        message:
          `${input.version}: manifest 里没有这条迁移——先跑 \`pnpm update:migrations-manifest\`，` +
          "或者检查版本号是不是写错了。不在登记里的迁移不能应用。",
      },
    };
  }
  if (input.fileText === null) {
    return {
      block: {
        code: "APPLY_FILE_UNREADABLE",
        message: `${entry.fileName ?? input.version}: 读不到迁移文件内容——文件被删了还是路径不对？`,
      },
    };
  }
  const sha256 = migrationSha256(input.fileText);
  if (entry.sha256 !== undefined && entry.sha256 !== sha256) {
    return {
      block: {
        code: "APPLY_SHA_MISMATCH",
        message:
          `${entry.fileName ?? input.version}: 文件内容与 manifest 登记的 SHA-256 不一致` +
          `（实际 ${sha256.slice(0, 12)}… / 登记 ${entry.sha256.slice(0, 12)}…）。` +
          "先查这局部改动是谁做的——应用一条与登记不一致的迁移等于绕过 check:migrations。",
      },
    };
  }
  if (isVersionApplied(input.version, input.applied, input.normalize)) {
    const raw =
      input.applied?.find((candidate) => candidate.version === input.normalize(input.version))?.raw ??
      input.version;
    return {
      block: {
        code: "APPLY_ALREADY_APPLIED",
        message:
          `${input.version}: 云端已 applied（历史行 ${raw}）——迁移文件不承诺幂等，重放会重复执行。` +
          "如果确有未生效的部分，用 ops:cloud-sql-probe 单独核对那一部分。",
      },
    };
  }
  if (typeof entry.fileName !== "string" || entry.fileName.length === 0) {
    return {
      block: {
        code: "APPLY_FILE_UNREADABLE",
        message: `${input.version}: manifest 条目没有 fileName，定位不到迁移文件`,
      },
    };
  }
  return {
    plan: {
      version: entry.version,
      fileName: entry.fileName,
      sha256: entry.sha256 ?? sha256,
      applySql: input.fileText,
      historyInsertSql: buildHistoryInsertSql(entry.version, entry.fileName, input.fileText),
    },
  };
}
