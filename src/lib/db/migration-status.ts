/**
 * 「云端那个库到底 applied 到第几版迁移」——能不能机器答，而且不要数据库密码？
 *
 * 起因是 2026-10-10 的那次 405 事故复盘：`supabase migration list --linked` 被本仓库
 * 误登记成「需要数据库密码，所以本机查不了」，代价是「034/035 从未 applied」
 * 直到线上出事才发现（见 `docs/operations/environments.md` 的「生产迁移状态」行）。
 * **这条误登记存在多久**：原先写的是「两年」——那是错的，而且**不可能对**，
 * 两个独立的上界都否证它：仓库第一个 commit 是 2026-08-09（GitHub `createdAt` 同日），
 * 到 2026-10-13 只有 **65 天**；即便取 CHANGELOG 里最早的版本条目 `## [0.1.0] — 2026-07-19`
 * （早于第一个 commit，说明那之前还有一段不在本仓库里的历史）也只有 **86 天**。
 * 无论按哪个口径，「两年」都差了一个数量级。
 * 按可查的锚点：「云端到了哪一版仍未取得」最早是 2026-09-22（`7ea846c1`，**21 天**），
 * 「要 DB 密码」这一具体说法是 2026-10-05（`1a18be40`，**8 天**）。
 * 后来确认这条命令**不要密码**——但它在**没有交互式登录态的机器上仍然跑不了**：
 * CLI 会挂在交互登录上（2026-10-12 本机实测两次，无输出、需手动终止）。
 * 也就是说「不要密码」不等于「谁都能查」：CI 里没有人能回答交互提示。
 *
 * 而 CI 里其实**已经有**能答这件事的东西：`SUPABASE_ACCESS_TOKEN`（secret）与
 * `SUPABASE_PROJECT_REF`（variable），二者已被 `security-config.yml` 与
 * `supabase-auto-restore.yml` 使用。Management API 的
 * `GET /v1/projects/{ref}/database/migrations`（operation `v1ListMigrationHistory`，
 * 描述「List applied migration versions」）是**只读**端点，响应形状从 CLI 2.120.0
 * 内嵌的 OpenAPI 规范里读到：`[{ version: string, name?: string }]`。
 * 2026-10-13 实测鉴权层次：匿名 **401**、格式合法的假 token **401**
 * （端点存在且要求鉴权，不是 404 那种「路径不存在」）。
 *
 * 所以本模块只做**判定**，不碰网络：给它 manifest 文本与云端返回的已应用列表，
 * 它回答「哪些还没上」。IO 在 `scripts/lib/migration-status-check.js`。
 *
 * 三条设计约束（与 `schema-drift.ts` 同源）：
 *   1. **读不到实况就说读不到**，绝不把「未知」压成「已一致」；
 *      但也不许把「读不到」说成「一条都没应用」——那是两种完全不同的结论；
 *   2. 版本号的**字符串形状不做假设**：CLI 的 `migration list --local` 实测返回
 *      `"001"`，而 Supabase 也支持 14 位时间戳形态。归一化只取前导数字段并按数值比较，
 *      展示时保留原始值。**这条假设已于 2026-10-13 被真实读数验证**：
 *      `.github/workflows/migration-status.yml` 首跑（main push，run 38294116244）
 *      拿到的是 3 位序号形态，输出 `MIGRATION_NOT_APPLIED 034`——与 `ops:schema-drift`
 *      独立测得的「生产缺 `notifications.email_skipped_reason`」互相印证。
 *      写在这里是为了说明**为什么归一化要写成形状无关的**，而不是「这还没验证过」；
 *   3. 云端有、本地 manifest 没有的版本**也报**：那说明有人在别处推过迁移，
 *      或者本地少了文件——两种都需要人看，静默忽略等于把探测器调成只会单向报错。
 */

/** 云端报告的一条已应用迁移。`raw` 保留服务端给的原始形状，便于人核对。 */
export interface AppliedMigration {
  raw: string;
  /** 归一化后的版本号；无法归一化时为 null。 */
  version: string | null;
  name?: string;
}

export type MigrationStatusIssueCode =
  | "MIGRATION_NOT_APPLIED"
  | "MIGRATION_UNKNOWN_TO_REPO"
  | "MIGRATION_LIVE_UNREADABLE"
  | "MIGRATION_LIVE_EMPTY"
  | "MIGRATION_VERSION_SHAPE_MISMATCH"
  | "MIGRATION_EXPECTED_NOT_IN_REPO"
  | "MIGRATION_MANIFEST_UNREADABLE";

export interface MigrationStatusIssue {
  code: MigrationStatusIssueCode;
  message: string;
}

export interface MigrationStatusReport {
  issues: MigrationStatusIssue[];
  /** manifest 里有、云端没有的版本（按 manifest 顺序）。 */
  pendingVersions: string[];
  /** 云端有、manifest 里没有的原始值。 */
  unknownToRepo: string[];
  stats: {
    /** 本仓库登记的迁移条数。 */
    declared: number;
    /** 云端报告的已应用条数。 */
    applied: number;
    /** 云端已应用里最高的版本号（数值意义），无法判定时为 null。 */
    highestApplied: string | null;
  };
}

/**
 * 把任意形状的版本号归一化成可比较的形态。
 *
 * 取**前导数字段**并剥掉前导零：`001` → `1`、`034` → `34`、
 * `20240101120000_add_x` → `20240101120000`。
 * 没有前导数字（返回 null）时**不参与比较**，由调用方按「未知」处理——
 * 宁可少判一条，也不拿一个猜出来的键去比出假警。
 */
export function normalizeMigrationVersion(raw: string): string | null {
  const match = /^\s*0*(\d+)/.exec(raw ?? "");
  return match ? match[1] : null;
}

/**
 * 解析 `v1ListMigrationHistory` 的响应。
 *
 * 只认「对象数组，每项有 `version` 字符串」这一种形状。
 * 形状不认识时返回 **null**（= 读不到），而不是 `[]`（= 一条都没应用）：
 * 把「API 换了形状」显示成「线上什么都没跑过」是这条探测器最坏的失败方式。
 */
export function parseAppliedMigrations(payload: unknown): AppliedMigration[] | null {
  if (!Array.isArray(payload)) return null;
  const parsed: AppliedMigration[] = [];
  for (const entry of payload) {
    if (typeof entry !== "object" || entry === null) return null;
    const version = (entry as { version?: unknown }).version;
    if (typeof version !== "string") return null;
    const name = (entry as { name?: unknown }).name;
    parsed.push({
      raw: version,
      version: normalizeMigrationVersion(version),
      ...(typeof name === "string" && name.length > 0 ? { name } : {}),
    });
  }
  return parsed;
}

export interface ManifestMigrationEntry {
  version: string;
  /** 可缺：没有文件名的条目只意味着「无法按名订正」，不该让版本解析失败。 */
  fileName?: string;
  /** 可缺：迁移应用流程（migration-apply）用它做执行前的完整性校验。 */
  sha256?: string;
}

/**
 * 从 manifest 文本里读出「版本号 + 文件名」完整条目。
 *
 * 版本号形状订正（`planVersionShapeFix`）需要 `fileName` 做匹配键：
 * Management API 的 `v1ListMigrationHistory` 每条带可选 `name`，而手工订正
 * `schema_migrations.version` 之前必须先知道那条时间戳形状的行对应仓库里
 * 哪一条迁移——**名字对得上才动，对不上就不动**。
 */
export function parseManifestEntries(manifestContent: string): ManifestMigrationEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestContent);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const migrations = (parsed as { migrations?: unknown }).migrations;
  if (!Array.isArray(migrations)) return null;
  const entries: ManifestMigrationEntry[] = [];
  for (const entry of migrations) {
    if (typeof entry !== "object" || entry === null) return null;
    const version = (entry as { version?: unknown }).version;
    const fileName = (entry as { fileName?: unknown }).fileName;
    const sha256 = (entry as { sha256?: unknown }).sha256;
    if (typeof version !== "string") return null;
    entries.push({
      version,
      ...(typeof fileName === "string" ? { fileName } : {}),
      ...(typeof sha256 === "string" ? { sha256 } : {}),
    });
  }
  return entries;
}

/**
 * 从 `supabase/migration-manifest.json` 的文本里读出登记的版本号。
 *
 * 解析失败返回 null——**由调用方判成「未知」，不是「0 条迁移」**。
 */
export function parseManifestVersions(manifestContent: string): string[] | null {
  const entries = parseManifestEntries(manifestContent);
  return entries ? entries.map((entry) => entry.version) : null;
}

/** 版本号排序：能归一化的按数值，归一化不了的排在最后并按原始串稳定排序。 */
function compareVersions(left: AppliedMigration, right: AppliedMigration): number {
  if (left.version === null && right.version === null) return left.raw.localeCompare(right.raw);
  if (left.version === null) return 1;
  if (right.version === null) return -1;
  const byNumber = Number(left.version) - Number(right.version);
  return byNumber !== 0 ? byNumber : left.raw.localeCompare(right.raw);
}

/** `MIGRATION_NOT_APPLIED` 的文案，唯一出处——IO 层与断言过滤都复用它，避免两处各写一遍。 */
export function notAppliedMessage(version: string): string {
  return `${version}: 本仓库有这条迁移，但云端没有它——多半是尚未 push 到该环境`;
}

/**
 * 「点名的版本号必须已在云端」这条断言的判据。
 *
 * 为什么单独要它：CI 里跑全量比对会把**别人正在做的迁移**也算成红，
 * 于是这条检查天天红，而天天红的检查等于没有检查。点名判据让它只回答
 * 一个可行动的问题：「**我要部署的这一版代码依赖的那几条，上了没有**」。
 *
 * 但点名引入一个新的假绿风险，必须一起堵上：
 * **点名的版本号如果在 manifest 里根本不存在**（写错、或它还没进仓库），
 * 那它既不会出现在 pending 里、也不会出现在云端里，过滤完是 0 条 issue ⇒
 * 显示「✅ 点名的迁移均已 applied」。那是拿一个**无法求值的断言**冒充通过。
 * 所以这里显式产出 `MIGRATION_EXPECTED_NOT_IN_REPO`，由调用方判成「未知」（退出码 2）。
 */
export function filterToExpectedVersions(
  report: MigrationStatusReport,
  manifestVersions: string[] | null,
  expected: readonly string[],
): MigrationStatusReport {
  if (expected.length === 0) return report;
  const wanted = new Set(expected.map((version) => version.trim()).filter((version) => version.length > 0));
  const declaredKeys = new Set(
    (manifestVersions ?? [])
      .map((version) => normalizeMigrationVersion(version))
      .filter((value): value is string => value !== null),
  );

  const pendingVersions = report.pendingVersions.filter((version) => wanted.has(version));
  const issues = report.issues.filter((issue) => issue.code !== "MIGRATION_NOT_APPLIED");
  for (const version of pendingVersions) {
    issues.unshift({ code: "MIGRATION_NOT_APPLIED", message: notAppliedMessage(version) });
  }
  for (const version of wanted) {
    const key = normalizeMigrationVersion(version);
    if (key === null || !declaredKeys.has(key)) {
      issues.push({
        code: "MIGRATION_EXPECTED_NOT_IN_REPO",
        message:
          `${version}: 被点名要求「必须已 applied」，但本仓库的 manifest 里没有这条迁移——` +
          "该断言无法求值，**不能算通过**。检查版本号是否写错，或该迁移是否还没进仓库。",
      });
    }
  }
  return { ...report, issues, pendingVersions };
}

/**
 * 比对「本仓库登记的迁移」与「云端已应用的迁移」。
 *
 * `applied === null` 表示**没读到**：只报一条 `MIGRATION_LIVE_UNREADABLE`，
 * 并且**不产出任何 pending 结论**——读不到云端时，「哪些还没上」无从谈起。
 *
 * `expected` 非空时把结论收窄到点名的版本号（见 `filterToExpectedVersions`）。
 */
export function inspectMigrationStatus(
  manifestVersions: string[] | null,
  applied: AppliedMigration[] | null,
  expected: readonly string[] = [],
): MigrationStatusReport {
  const empty = { declared: 0, applied: 0, highestApplied: null };

  if (manifestVersions === null) {
    return {
      issues: [
        {
          code: "MIGRATION_MANIFEST_UNREADABLE",
          message:
            "读不出 `supabase/migration-manifest.json` 里的版本号——没有「本仓库登记了哪些迁移」的基准，" +
            "比对无从谈起。先跑 `pnpm update:migrations-manifest`。",
        },
      ],
      pendingVersions: [],
      unknownToRepo: [],
      stats: empty,
    };
  }

  if (applied === null) {
    return {
      issues: [
        {
          code: "MIGRATION_LIVE_UNREADABLE",
          message:
            "读不到云端已应用的迁移列表（缺凭据、网络失败、或 Management API 换了形状）——" +
            "**未知不算通过**，但也不能据此推断「一条都没应用」。请先修好探测本身，再看结论。",
        },
      ],
      pendingVersions: [],
      unknownToRepo: [],
      stats: { ...empty, declared: manifestVersions.length },
    };
  }

  const appliedKeys = new Set(
    applied.map((entry) => entry.version).filter((value): value is string => value !== null),
  );
  const declaredKeys = new Set(
    manifestVersions
      .map((version) => normalizeMigrationVersion(version))
      .filter((value): value is string => value !== null),
  );

  // **两边完全不相交 ⇒ 先怀疑「不可比」，而不是「一条都没应用」。**
  // 2026-10-13 用本地 mock 实测到这条：云端返回 14 位时间戳版本号
  // （`2026001010101010`）、本地 manifest 是 3 位序号（`001`）时，
  // 归一化后的键永不相交，于是探测器一口气报了 34 条「未应用」+ 34 条「本地不认识」——
  // 68 条结论全都建立在「两边版本号是同一种形状」这个**没有验证过的假设**上。
  // 真实场景里同一个项目的版本号形状是一致的，所以不相交几乎必然是形状/口径问题；
  // 而「云端真的空着」有专门的分支（`applied.length === 0`）负责，不会被这里吞掉。
  const intersects = [...appliedKeys].some((key) => declaredKeys.has(key));
  if (applied.length > 0 && manifestVersions.length > 0 && !intersects) {
    return {
      issues: [
        {
          code: "MIGRATION_VERSION_SHAPE_MISMATCH",
          message:
            `云端报告的 ${applied.length} 条迁移与本仓库登记的 ${manifestVersions.length} 条` +
            "**一条都对不上**——先怀疑两边版本号不是同一种形状（序号 vs 时间戳）或查错了项目，" +
            "而不是「一条都没应用」。未知不算通过，但错口径的差集比未知更危险。",
        },
      ],
      pendingVersions: [],
      unknownToRepo: [],
      stats: {
        declared: manifestVersions.length,
        applied: applied.length,
        highestApplied: [...applied].sort(compareVersions)[applied.length - 1]?.raw ?? null,
      },
    };
  }

  const issues: MigrationStatusIssue[] = [];
  const pendingVersions = manifestVersions.filter((version) => {
    const key = normalizeMigrationVersion(version);
    // 归一化不了的版本号不能判「已应用」，也不能凭空判「未应用」——
    // 它长得就不像版本号，交给下面那条「扫不到东西」的兜底去暴露。
    if (key === null) return false;
    return !appliedKeys.has(key);
  });
  const unknownToRepo = applied
    .filter((entry) => entry.version !== null && !declaredKeys.has(entry.version))
    .map((entry) => entry.raw);

  for (const version of pendingVersions) {
    issues.push({
      code: "MIGRATION_NOT_APPLIED",
      message: notAppliedMessage(version),
    });
  }
  for (const raw of unknownToRepo) {
    issues.push({
      code: "MIGRATION_UNKNOWN_TO_REPO",
      message: `${raw}: 云端有这条迁移，但本仓库的 manifest 里没有——有人在别处推过，或本地少了文件`,
    });
  }

  // 两边都空 = 这条检查此刻什么都没看，那它也不构成任何证据。
  if (applied.length === 0 && manifestVersions.length === 0) {
    issues.push({
      code: "MIGRATION_LIVE_EMPTY",
      message:
        "云端返回空列表且本地 manifest 也是空的——比对集为空，" +
        "这条检查此刻不构成证据（**扫不到东西的检查等于没有检查**）。",
    });
  }

  const sorted = [...applied].sort(compareVersions);
  const highest = sorted.length > 0 ? sorted[sorted.length - 1] : null;

  const report: MigrationStatusReport = {
    issues,
    pendingVersions,
    unknownToRepo,
    stats: {
      declared: manifestVersions.length,
      applied: applied.length,
      highestApplied: highest ? highest.raw : null,
    },
  };
  // 点名断言只收窄「哪些算未应用」这一类结论；云端多出来的迁移与「扫不到东西」
  // 那两条兜底**照报**——它们与点名无关，藏起来就是把探测器调成只会单向报错。
  return filterToExpectedVersions(report, manifestVersions, expected);
}

/** 一笔版本号订正：把云端 `fromRaw` 那行的版本号改成仓库登记的 `toVersion`。 */
export interface VersionShapeFix {
  /** 云端 `schema_migrations.version` 里的原始值（14 位时间戳形态等）。 */
  fromRaw: string;
  /** manifest 里登记的目标版本号（3 位序号形态）。 */
  toVersion: string;
  /** 匹配依据（现在只有一种：按迁移文件名对上）。 */
  matchedBy: string;
}

export interface VersionShapeFixPlan {
  updates: VersionShapeFix[];
  /** 对不上仓库任何一条迁移的云端行——只报不动，留给人工判断。 */
  unmapped: AppliedMigration[];
}

/** 剥掉迁移文件名的 `.sql` 后缀，作为与 API `name` 字段比较的键。 */
function normalizeFileName(fileName: string): string {
  return fileName.replace(/\.sql$/i, "");
}

/**
 * 生成「版本号形状订正计划」：把云端以时间戳形状落库的行映射回 manifest 的序号。
 *
 * 起因（2026-10-24 台账）：用 Management API `POST /database/query` 应用迁移时，
 * `schema_migrations.version` 落的是 14 位时间戳形态，与 manifest 的 3 位序号
 * **形状不匹配**，判定层把它读成「本地不认识的迁移」，需要人手工 UPDATE。
 * 本函数把那次的手工活变成可判定的计划——但**只做能证明安全的部分**：
 *   - 只动「归一化版本号不在 manifest 里」的行（已在 manifest 里的行不可能订正）；
 *   - 匹配键**只有迁移文件名**（云端 `name` ↔ manifest `fileName`，剥 `.sql` 后全等）——
 *     没有名字、名字对不上，就不猜：时间戳的先后顺序与 manifest 序号的对应关系
 *     是一个没有验证过的假设，拿它去 UPDATE 生产表是拿猜测当证据；
 *   - 两行映射到同一个目标版本号 = 计划自相矛盾，这两行**整体拒判**，
 *     宁可留给人看，也不挑一个「看起来更像」的写进去。
 */
export function planVersionShapeFix(
  applied: AppliedMigration[],
  entries: ManifestMigrationEntry[],
): VersionShapeFixPlan {
  const declaredKeys = new Set(
    entries.map((entry) => normalizeMigrationVersion(entry.version)).filter((value): value is string => value !== null),
  );
  const versionByFileName = new Map(
    entries
      .filter((entry): entry is ManifestMigrationEntry & { fileName: string } => typeof entry.fileName === "string")
      .map((entry) => [normalizeFileName(entry.fileName), entry.version]),
  );

  const updates: VersionShapeFix[] = [];
  const unmapped: AppliedMigration[] = [];
  for (const entry of applied) {
    if (entry.version !== null && declaredKeys.has(entry.version)) continue;
    const target = entry.name === undefined ? undefined : versionByFileName.get(normalizeFileName(entry.name));
    if (target === undefined) {
      unmapped.push(entry);
      continue;
    }
    updates.push({ fromRaw: entry.raw, toVersion: target, matchedBy: `name=${entry.name}` });
  }

  // 目标版本号被两行同时认领：计划自相矛盾，涉及的行全部转 unmapped。
  const byTarget = new Map<string, number>();
  for (const fix of updates) {
    byTarget.set(fix.toVersion, (byTarget.get(fix.toVersion) ?? 0) + 1);
  }
  const ambiguous = new Set([...byTarget].filter(([, count]) => count > 1).map(([version]) => version));
  if (ambiguous.size > 0) {
    const kept: VersionShapeFix[] = [];
    for (const fix of updates) {
      if (ambiguous.has(fix.toVersion)) {
        unmapped.push({ raw: fix.fromRaw, version: normalizeMigrationVersion(fix.fromRaw) });
      } else {
        kept.push(fix);
      }
    }
    updates.length = 0;
    updates.push(...kept);
  }

  return { updates, unmapped };
}
