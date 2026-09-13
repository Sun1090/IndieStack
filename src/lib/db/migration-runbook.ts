/**
 * 迁移回滚 runbook 规则（I10）。
 *
 * 背景：仓库每个版本都有一份 `rollback-runbook-vX.Y.Z.md`，但它们都写「回滚优先恢复服务，
 * 不自动回滚数据库」，没有一个地方把「哪些迁移可以逆向、哪些只能前向修复、怎么验证」
 * 写成可执行的统一流程。同时 runbook 里的「最新迁移是 031_upload_objects.sql」这类事实
 * 靠手抄，迁移一多必然过期。
 *
 * 本模块把这件事固化为可执行规则，全部为纯函数：
 *
 *   - 必备章节必须齐全（触发条件 / 决策树 / 前向修复优先 / 迁移类型与回滚配方 / 操作步骤 /
 *     回滚后验证 / 权限与审批 / 演练记录）；
 *   - 必须带一条机器可读的「最新迁移」标记，且与 `supabase/migrations/` 的真实最新迁移一致；
 *   - 文档里提到的每个迁移文件名都必须真实存在；
 *   - 必备验证命令必须出现，引用的每个 `pnpm <script>` 必须真实存在；
 *   - 抽取为空时失败封闭，避免正则失效被当成「零问题」。
 *
 * 规则只判断 runbook 与仓库事实一致，不判断文案质量，也不替代演练。
 */

export interface MigrationManifestEntry {
  version: string;
  fileName: string;
}

export interface MigrationRunbookDocument {
  /** 仓库相对路径，仅用于报错定位。 */
  path: string;
  content: string;
}

export interface MigrationRunbookInput {
  /** 需要校验的 runbook。 */
  documents: readonly MigrationRunbookDocument[];
  /** `supabase/migration-manifest.json` 里的迁移清单（顺序不限）。 */
  migrations: readonly MigrationManifestEntry[];
  /** `package.json` 的 scripts 注册表。 */
  scripts: Readonly<Record<string, string>>;
}

export type MigrationRunbookIssueCode =
  | "RUNBOOK_SOURCE_EMPTY"
  | "RUNBOOK_MISSING_SECTION"
  | "RUNBOOK_MISSING_LATEST_MARKER"
  | "RUNBOOK_STALE_LATEST"
  | "RUNBOOK_UNKNOWN_MIGRATION"
  | "RUNBOOK_MISSING_REQUIRED_COMMAND"
  | "RUNBOOK_UNKNOWN_COMMAND";

export interface MigrationRunbookIssue {
  code: MigrationRunbookIssueCode;
  path: string;
  detail: string;
}

export interface MigrationRunbookReport {
  issues: MigrationRunbookIssue[];
  latest: string | null;
  migrations: number;
}

/** 每份 runbook 都必须包含的章节标题（精确匹配行首）。 */
export const REQUIRED_RUNBOOK_SECTIONS: readonly string[] = [
  "## 触发条件",
  "## 决策树",
  "## 前向修复优先",
  "## 迁移类型与回滚配方",
  "## 操作步骤",
  "## 回滚后验证",
  "## 权限与审批",
  "## 演练记录",
];

/** runbook 必须给出的验证命令；缺一条即失败。 */
export const REQUIRED_RUNBOOK_COMMANDS: readonly string[] = [
  "check:migrations",
  "check:migration-history",
  "update:migrations-manifest",
];

/** runbook 必须覆盖的关键事实锚点。 */
export const REQUIRED_RUNBOOK_FACTS: readonly string[] = [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROJECT_REF",
  "不自动回滚数据库",
];

/** 机器可读标记：`<!-- migration-runbook:latest=031_upload_objects.sql -->`。 */
const LATEST_MARKER = /<!--\s*migration-runbook:latest=([0-9]{3}_[a-z0-9_]+\.sql)\s*-->/;
const MIGRATION_FILE = /(?:^|[^0-9a-z_])([0-9]{3}_[a-z0-9_]+\.sql)/g;
const PNPM_COMMAND = /`pnpm\s+([a-z][a-z0-9:.-]*)`/g;

/** `pnpm` 内置子命令，允许出现在 runbook 里但不属于 package.json scripts。 */
export const PNPM_BUILTINS: readonly string[] = [
  "add",
  "audit",
  "dlx",
  "exec",
  "install",
  "list",
  "remove",
  "run",
  "update",
  "why",
];

/** 按版本号取最新迁移；清单为空时返回 null。 */
export function latestMigration(
  migrations: readonly MigrationManifestEntry[],
): MigrationManifestEntry | null {
  let latest: MigrationManifestEntry | null = null;
  for (const migration of migrations) {
    if (latest === null || migration.version > latest.version) latest = migration;
  }
  return latest;
}

/** 抽取机器可读的「最新迁移」标记，未登记时返回 null。 */
export function parseLatestMarker(content: string): string | null {
  return LATEST_MARKER.exec(content)?.[1] ?? null;
}

/** 抽取文档里提到的全部迁移文件名（保持出现顺序、去重）。 */
export function extractReferencedMigrations(content: string): string[] {
  const files = new Set<string>();
  for (const match of content.matchAll(MIGRATION_FILE)) files.add(match[1]);
  return [...files];
}

/** 抽取文档里引用的全部 `pnpm <script>`（保持出现顺序、去重）。 */
export function extractRunbookCommands(content: string): string[] {
  const commands = new Set<string>();
  for (const match of content.matchAll(PNPM_COMMAND)) commands.add(match[1]);
  return [...commands];
}

function auditRequiredSections(
  document: MigrationRunbookDocument,
  issues: MigrationRunbookIssue[],
): void {
  for (const section of REQUIRED_RUNBOOK_SECTIONS) {
    if (!document.content.includes(section)) {
      issues.push({
        code: "RUNBOOK_MISSING_SECTION",
        path: document.path,
        detail: `缺少必备章节 ${section}`,
      });
    }
  }
}

function auditRequiredFacts(
  document: MigrationRunbookDocument,
  issues: MigrationRunbookIssue[],
): void {
  for (const fact of REQUIRED_RUNBOOK_FACTS) {
    if (!document.content.includes(fact)) {
      issues.push({
        code: "RUNBOOK_MISSING_SECTION",
        path: document.path,
        detail: `缺少必备事实 ${fact}`,
      });
    }
  }
}

function auditLatestMarker(
  document: MigrationRunbookDocument,
  latest: MigrationManifestEntry | null,
  issues: MigrationRunbookIssue[],
): void {
  const marker = parseLatestMarker(document.content);
  if (marker === null) {
    issues.push({
      code: "RUNBOOK_MISSING_LATEST_MARKER",
      path: document.path,
      detail: "缺少机器可读的 <!-- migration-runbook:latest=... --> 标记",
    });
    return;
  }
  if (latest !== null && marker !== latest.fileName) {
    issues.push({
      code: "RUNBOOK_STALE_LATEST",
      path: document.path,
      detail: `标记的最新迁移 ${marker} 与真实最新迁移 ${latest.fileName} 不一致`,
    });
  }
}

function auditMigrationReferences(
  document: MigrationRunbookDocument,
  migrations: readonly MigrationManifestEntry[],
  issues: MigrationRunbookIssue[],
): void {
  const known = new Set(migrations.map((migration) => migration.fileName));
  for (const file of extractReferencedMigrations(document.content)) {
    if (!known.has(file)) {
      issues.push({
        code: "RUNBOOK_UNKNOWN_MIGRATION",
        path: document.path,
        detail: `引用了不存在的迁移 ${file}`,
      });
    }
  }
}

function auditRequiredCommands(
  document: MigrationRunbookDocument,
  issues: MigrationRunbookIssue[],
): void {
  for (const command of REQUIRED_RUNBOOK_COMMANDS) {
    if (!document.content.includes(`\`pnpm ${command}\``)) {
      issues.push({
        code: "RUNBOOK_MISSING_REQUIRED_COMMAND",
        path: document.path,
        detail: `缺少必备命令 pnpm ${command}`,
      });
    }
  }
}

function auditKnownCommands(
  document: MigrationRunbookDocument,
  scripts: Readonly<Record<string, string>>,
  issues: MigrationRunbookIssue[],
): void {
  const builtins = new Set(PNPM_BUILTINS);
  for (const command of extractRunbookCommands(document.content)) {
    if (!builtins.has(command) && !(command in scripts)) {
      issues.push({
        code: "RUNBOOK_UNKNOWN_COMMAND",
        path: document.path,
        detail: `引用了不存在的脚本 pnpm ${command}`,
      });
    }
  }
}

function auditDocument(
  document: MigrationRunbookDocument,
  migrations: readonly MigrationManifestEntry[],
  latest: MigrationManifestEntry | null,
  scripts: Readonly<Record<string, string>>,
  issues: MigrationRunbookIssue[],
): void {
  if (document.content.trim().length === 0) {
    issues.push({
      code: "RUNBOOK_SOURCE_EMPTY",
      path: document.path,
      detail: "迁移回滚 runbook 为空",
    });
    return;
  }

  auditRequiredSections(document, issues);
  auditRequiredFacts(document, issues);
  auditLatestMarker(document, latest, issues);
  auditMigrationReferences(document, migrations, issues);
  auditRequiredCommands(document, issues);
  auditKnownCommands(document, scripts, issues);
}

/** 审计迁移回滚 runbook；纯函数，不读取文件系统。 */
export function auditMigrationRunbook(input: MigrationRunbookInput): MigrationRunbookReport {
  const latest = latestMigration(input.migrations);
  const issues: MigrationRunbookIssue[] = [];

  if (input.documents.length === 0) {
    issues.push({ code: "RUNBOOK_SOURCE_EMPTY", path: "-", detail: "没有传入需要校验的 runbook" });
  }
  if (input.migrations.length === 0) {
    issues.push({
      code: "RUNBOOK_SOURCE_EMPTY",
      path: "supabase/migration-manifest.json",
      detail: "迁移清单为空，无法判定最新迁移",
    });
  }
  for (const document of input.documents) {
    auditDocument(document, input.migrations, latest, input.scripts, issues);
  }

  return { issues, migrations: input.migrations.length, latest: latest?.fileName ?? null };
}

/** 格式化为带规则码的文本，供 CLI 和测试复用。 */
export function formatMigrationRunbookIssues(issues: readonly MigrationRunbookIssue[]): string {
  return issues.map((item) => `❌ [${item.code}] ${item.path} ${item.detail}`).join("\n");
}
