/**
 * 「代码以为库里有这一列」与「库里真有这一列」的差，能不能机器查？
 *
 * 起因是 2026-10-12 的一次实测。`check:query-columns` 把代码里每个字面列名
 * 都对着**生成的类型**核过，全仓 0 error；`check:migrations` 34 条全绿；
 * `pnpm build` 也过。可生产库里就是没有 `notifications.email_skipped_reason`
 * （迁移 034 从未 applied）。也就是说**三道门禁都在证明一个不成立的结论**：
 * 它们比的是「代码 vs types vs 迁移文件」，没有一条比到「线上那个库」。
 *
 * 后果不是理论上的：`listUnsentEmailNotifications()` 对缺列的查询是
 * `if (error) throw new Error(error.message)`，digest worker 因此**每轮必抛**。
 * 今天没人看见，只因为 `/api/cron/digest` 对 GET 返回 405（另一个缺陷，PR #236 在修）
 * ——**两个缺陷正好互相掩盖**：修好 405 的那一刻，缺列才第一次真的露头。
 *
 * 而这件事**不需要数据库密码**：PostgREST 在根端点用 `Accept: application/openapi+json`
 * 暴露完整 schema。2026-10-12 实测：匿名 401、service_role key 200，
 * `definitions` 里 26 张表，`notifications` 的 11 个属性中确实没有那一列。
 *
 * 三条设计约束：
 *   1. **拿不到实况就说拿不到**，绝不推断「没装」也绝不推断「一致」——
 *      一条会把「未知」显示成「通过」的检查，比没有检查更危险；
 *   2. 默认**只报代码真的引用了的**缺失项。生产上多出来的表
 *      （实测 5 张：`progress`/`wrongbook`/`quiz_scores`/`replay_best`/`replay_history`）
 *      是「这个 Supabase 项目还放了别的东西」，不是漂移，默认只数不报；
 *   3. 这是**运维命令**，不是 CI 门禁：它需要网络与一把 key，
 *      放进 `check:all` 就等于制造一个天天因缺凭据而红的信号位。
 */

import { parseGeneratedTables } from "./query-columns.ts";

/** PostgREST 根端点 OpenAPI 里的一张表。 */
export interface LiveTable {
  table: string;
  columns: string[];
}

export type SchemaDriftIssueCode =
  | "SCHEMA_LIVE_TABLE_MISSING"
  | "SCHEMA_LIVE_COLUMN_MISSING"
  | "SCHEMA_LIVE_UNREADABLE"
  | "SCHEMA_LIVE_EMPTY";

export interface SchemaDriftIssue {
  code: SchemaDriftIssueCode;
  message: string;
}

export interface SchemaDriftReport {
  issues: SchemaDriftIssue[];
  /** 生产上多出来、代码从不引用的表——如实报告，但不算漂移。 */
  unmanagedTables: string[];
  stats: {
    /** 生成类型里的表数（= 代码认为 schema 应该是什么）。 */
    declaredTables: number;
    /** OpenAPI 里暴露的表数。 */
    liveTables: number;
    /** 真正被代码引用、且参与比对的表数。 */
    referencedTables: number;
    /** 比对过的列数。 */
    checkedColumns: number;
  };
}

/**
 * 从 PostgREST 的 OpenAPI 文档里读出表与列。
 *
 * 只认 `definitions[table].properties` 的键：那层结构里没有嵌套 `properties`
 * （2026-10-12 实测 26 张表全部如此），所以不必处理嵌入关系。
 * 解析不出来时返回 `null`——**由调用方决定这是「未知」而不是「空库」**。
 */
export function parseLiveSchema(document: unknown): LiveTable[] | null {
  if (typeof document !== "object" || document === null) return null;
  const definitions = (document as { definitions?: unknown }).definitions;
  if (typeof definitions !== "object" || definitions === null) return null;

  const tables: LiveTable[] = [];
  for (const [name, value] of Object.entries(definitions as Record<string, unknown>)) {
    const properties =
      typeof value === "object" && value !== null
        ? (value as { properties?: unknown }).properties
        : undefined;
    if (typeof properties !== "object" || properties === null) continue;
    tables.push({ table: name, columns: Object.keys(properties) });
  }
  return tables;
}

/**
 * 代码实际引用了哪些表：`.from("<字面量>")`。
 *
 * 只认字面量表名——变量表名无法静态归属到某张表，宁可少比对，
 * 也不要拿错的表名去比出假警。
 */
export function collectReferencedTables(
  sources: ReadonlyArray<{ file: string; content: string }>,
): Set<string> {
  const tables = new Set<string>();
  const text = sources.map((source) => source.content).join("\n");
  for (const match of text.matchAll(/\.from\(\s*"([a-z_][\w]*)"\s*\)/g)) {
    tables.add(match[1]);
  }
  return tables;
}

/**
 * 比对「代码期望的 schema」与「线上实况」。
 *
 * `live === null` 表示**没读到**（网络失败、key 不对、端点变了形状）。
 * 此时只报一条 `SCHEMA_LIVE_UNREADABLE` 并让调用方以非零码退出：
 * 未知不算通过，但也不能把「读不到」说成「库里没有」。
 */
export function inspectSchemaDrift(
  typesContent: string,
  sources: ReadonlyArray<{ file: string; content: string }>,
  live: LiveTable[] | null,
): SchemaDriftReport {
  if (live === null) {
    return {
      issues: [
        {
          code: "SCHEMA_LIVE_UNREADABLE",
          message:
            "读不到线上 schema（网络、凭据或 OpenAPI 形状变化）——**未知不算通过**，" +
            "但也不能据此推断「列不存在」。请先修好探测本身，再看结论。",
        },
      ],
      unmanagedTables: [],
      stats: { declaredTables: 0, liveTables: 0, referencedTables: 0, checkedColumns: 0 },
    };
  }

  const declared = parseGeneratedTables(typesContent);
  const liveByTable = new Map(live.map((table) => [table.table, new Set(table.columns)]));
  const referenced = collectReferencedTables(sources);
  const issues: SchemaDriftIssue[] = [];
  let checkedColumns = 0;
  let comparedTables = 0;

  for (const table of declared) {
    if (!referenced.has(table.table)) continue;
    comparedTables += 1;
    const columns = liveByTable.get(table.table);
    if (columns === undefined) {
      issues.push({
        code: "SCHEMA_LIVE_TABLE_MISSING",
        message: `${table.table}: 代码引用了这张表，但线上 schema 里没有它`,
      });
      continue;
    }
    for (const column of table.columns) {
      checkedColumns += 1;
      if (!columns.has(column)) {
        issues.push({
          code: "SCHEMA_LIVE_COLUMN_MISSING",
          message:
            `${table.table}.${column}: 生成的类型里有、线上没有` +
            "——多半是对应的迁移尚未 applied 到该环境",
        });
      }
    }
  }

  // 空比对 = 这条检查什么都没看，那它此刻也不构成任何证据。
  if (comparedTables === 0) {
    issues.push({
      code: "SCHEMA_LIVE_EMPTY",
      message:
        "没有任何一张表同时被代码引用且出现在生成类型里——比对集为空，" +
        "这条检查此刻不构成证据（**扫不到东西的检查等于没有检查**）。",
    });
  }

  const unmanagedTables = [...liveByTable.keys()]
    .filter((name) => !declared.some((table) => table.table === name))
    .sort();

  return {
    issues,
    unmanagedTables,
    stats: {
      declaredTables: declared.length,
      liveTables: liveByTable.size,
      referencedTables: comparedTables,
      checkedColumns,
    },
  };
}
