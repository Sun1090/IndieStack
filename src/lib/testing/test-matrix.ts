/**
 * 贡献者测试矩阵规则（I09）。
 *
 * 背景：贡献者最常问的两个问题是「我改了这块要跑哪些门禁」和「文档里写的命令还存在吗」。
 * 这两件事此前都散落在 `CONTRIBUTING.md` 的一句 `pnpm verify:all` 和各章节的散文里，
 * 既没有按改动领域给出最小验证集，也没有任何门禁保证矩阵引用的命令真实存在。
 *
 * 本模块把「改动领域 → 覆盖路径 → 必须运行的门禁」固化为可执行规则，全部为纯函数：
 *
 *   - 注册表里的每个领域都必须出现在每份矩阵文档的表格里，反之亦然；
 *   - 每个领域的每条门禁都必须写在该领域的行里（不接受「全文任意位置出现过」）；
 *   - 文档里引用的每个 `pnpm <script>` 都必须真实存在于 `package.json`（内置命令白名单除外）；
 *   - 抽取结果为空时失败封闭，避免正则失效被当成「零问题」。
 *
 * 规则只判断矩阵与仓库事实一致，不判断文案质量；路径是否还存在由 IO 层校验。
 */

export interface TestMatrixArea {
  /** 表格首列登记用的稳定 id（kebab-case）。 */
  id: string;
  /** 中文领域名。 */
  zh: string;
  /** 英文领域名。 */
  en: string;
  /** 该领域覆盖的仓库相对路径（前缀或具体文件）。 */
  paths: readonly string[];
  /** 改动该领域后必须运行的 package.json 脚本名（不含 `pnpm` 前缀）。 */
  commands: readonly string[];
}

/** 改动领域注册表——单一事实源，矩阵文档必须逐项覆盖。 */
export const TEST_MATRIX: readonly TestMatrixArea[] = [
  {
    id: "ui",
    zh: "界面与样式",
    en: "UI & styling",
    paths: ["src/components", "src/app"],
    commands: [
      "check:tailwind",
      "check:tokens",
      "check:fields",
      "check:states",
      "check:a11y",
      "test",
      "test:visual",
    ],
  },
  {
    id: "server-actions",
    zh: "Server Actions 与仓储",
    en: "Server actions & repositories",
    paths: ["src/lib/actions", "src/lib/repositories"],
    commands: ["test", "test:coverage", "type-check", "check:rls"],
  },
  {
    id: "api-routes",
    zh: "Route Handlers",
    en: "Route handlers",
    paths: ["src/app/api"],
    commands: ["test", "test:e2e"],
  },
  {
    id: "auth-mfa",
    zh: "认证与 MFA",
    en: "Auth & MFA",
    paths: ["src/lib/auth", "src/app/auth"],
    commands: ["test", "test:e2e", "check:security"],
  },
  {
    id: "database",
    zh: "数据库与迁移",
    en: "Database & migrations",
    paths: ["supabase/migrations", "supabase/migration-manifest.json"],
    commands: [
      "check:migrations",
      "check:migration-history",
      "update:migrations-manifest",
      "db:types",
      "smoke:supabase-identity",
    ],
  },
  {
    id: "rls-security",
    zh: "RLS 与安全配置",
    en: "RLS & security config",
    paths: ["src/proxy.ts", "src/lib/security"],
    commands: ["check:rls", "check:security", "check:supabase-security"],
  },
  {
    id: "i18n",
    zh: "多语言",
    en: "Internationalization",
    paths: ["messages", "src/i18n"],
    commands: ["check:locales", "check:i18n"],
  },
  {
    id: "providers",
    zh: "Provider 配置",
    en: "Provider configuration",
    paths: ["src/lib/providers", "docs-site/provider-diagnostics.md"],
    commands: ["check:provider-docs", "provider:doctor"],
  },
  {
    id: "mock",
    zh: "Mock 运行时",
    en: "Mock runtime",
    paths: ["src/lib/mock", "src/app/api/e2e"],
    commands: ["check:mock-docs", "test:e2e"],
  },
  {
    id: "ci-tooling",
    zh: "CI 与脚本",
    en: "CI & tooling",
    paths: [".github/workflows", "scripts", "package.json"],
    commands: ["check:gates", "check:workflows", "lint", "type-check", "test", "check:all"],
  },
  {
    id: "docs",
    zh: "文档",
    en: "Documentation",
    paths: ["docs", "docs-site"],
    commands: ["check:docs", "check:adr", "check:changelog", "check:release-docs"],
  },
];

export type TestMatrixIssueCode =
  | "MATRIX_SOURCE_EMPTY"
  | "MATRIX_MISSING_AREA"
  | "MATRIX_UNKNOWN_AREA"
  | "MATRIX_MISSING_COMMAND"
  | "MATRIX_MISSING_PATH"
  | "MATRIX_UNKNOWN_COMMAND";

export interface TestMatrixIssue {
  code: TestMatrixIssueCode;
  path: string;
  area?: string;
  command?: string;
  detail: string;
}

export interface TestMatrixDocument {
  /** 仓库相对路径，仅用于报错定位。 */
  path: string;
  content: string;
}

export interface TestMatrixInput {
  /** 需要校验的矩阵文档（中英各一份）。 */
  documents: readonly TestMatrixDocument[];
  /** `package.json` 的 scripts 注册表，用于确认命令真实存在。 */
  scripts: Readonly<Record<string, string>>;
  /** 覆盖注册表，默认使用 TestMatrixArea。 */
  areas?: readonly TestMatrixArea[];
}

export interface TestMatrixReport {
  issues: TestMatrixIssue[];
  areas: number;
  commands: number;
}

/** `pnpm` 内置子命令，允许出现在矩阵里但不属于 package.json scripts。 */
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

const MARKDOWN_ROW_FIRST_CELL = /^\|([^|]*)\|/;
const MARKDOWN_SEPARATOR_ROW = /^\|[\s:|-]*-[\s:|-]*\|/;
const INLINE_CODE_AREA_ID = /^`([a-z][a-z0-9-]*)`$/;
const MATRIX_HEADERS = new Set(["领域", "改动领域", "area", "change area"]);
const PNPM_COMMAND = /`pnpm\s+([a-z][a-z0-9:.-]*)`/g;

function firstCell(line: string): string | null {
  const match = MARKDOWN_ROW_FIRST_CELL.exec(line);
  return match ? match[1].trim() : null;
}

function isSeparatorRow(line: string): boolean {
  return MARKDOWN_SEPARATOR_ROW.test(line.trim());
}

function normalizeHeader(cell: string): string {
  return cell.replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isMatrixHeader(cell: string): boolean {
  return MATRIX_HEADERS.has(normalizeHeader(cell));
}

/**
 * 抽取矩阵文档登记的行：只认首列表头为「领域 / Area」且第二行是分隔线的表格，
 * 数据行首列必须是行内代码形式的领域 id。返回 id → 整行文本。
 */
export function extractMatrixRows(markdown: string): Map<string, string> {
  const lines = markdown.split(/\r?\n/);
  const rows = new Map<string, string>();
  let insideMatrix = false;

  for (let index = 0; index < lines.length; index += 1) {
    const cell = firstCell(lines[index]);
    if (cell === null) {
      insideMatrix = false;
      continue;
    }
    if (!insideMatrix) {
      insideMatrix = isMatrixHeader(cell) && isSeparatorRow(lines[index + 1] ?? "");
      continue;
    }
    const id = INLINE_CODE_AREA_ID.exec(cell);
    if (id && !rows.has(id[1])) rows.set(id[1], lines[index]);
  }

  return rows;
}

/** 抽取文档里引用的所有 `pnpm <script>`（保持出现顺序、去重）。 */
export function extractDocumentedCommands(markdown: string): string[] {
  const commands = new Set<string>();
  for (const match of markdown.matchAll(PNPM_COMMAND)) commands.add(match[1]);
  return [...commands];
}

function auditDocument(
  document: TestMatrixDocument,
  areas: readonly TestMatrixArea[],
  scripts: Readonly<Record<string, string>>,
  issues: TestMatrixIssue[],
): number {
  if (document.content.trim().length === 0) {
    issues.push({
      code: "MATRIX_SOURCE_EMPTY",
      path: document.path,
      detail: "矩阵文档为空",
    });
    return 0;
  }

  const rows = extractMatrixRows(document.content);
  if (rows.size === 0) {
    issues.push({
      code: "MATRIX_SOURCE_EMPTY",
      path: document.path,
      detail: "未能从矩阵文档中抽出任何领域行，抽取规则可能已失效",
    });
  }

  const known = new Set(areas.map((area) => area.id));
  for (const id of rows.keys()) {
    if (!known.has(id)) {
      issues.push({
        code: "MATRIX_UNKNOWN_AREA",
        path: document.path,
        area: id,
        detail: `矩阵登记了注册表里不存在的领域 ${id}`,
      });
    }
  }

  let commandCount = 0;
  for (const area of areas) {
    commandCount += area.commands.length;
    const row = rows.get(area.id);
    if (row === undefined) {
      issues.push({
        code: "MATRIX_MISSING_AREA",
        path: document.path,
        area: area.id,
        detail: `领域 ${area.id} 未登记在矩阵表格里`,
      });
      continue;
    }
    for (const command of area.commands) {
      if (!row.includes(`\`pnpm ${command}\``)) {
        issues.push({
          code: "MATRIX_MISSING_COMMAND",
          path: document.path,
          area: area.id,
          command,
          detail: `领域 ${area.id} 的行里缺少门禁 pnpm ${command}`,
        });
      }
    }
    for (const repoPath of area.paths) {
      if (!document.content.includes(repoPath)) {
        issues.push({
          code: "MATRIX_MISSING_PATH",
          path: document.path,
          area: area.id,
          detail: `领域 ${area.id} 的覆盖路径 ${repoPath} 未出现在文档里`,
        });
      }
    }
  }

  const builtins = new Set(PNPM_BUILTINS);
  for (const command of extractDocumentedCommands(document.content)) {
    if (!builtins.has(command) && !(command in scripts)) {
      issues.push({
        code: "MATRIX_UNKNOWN_COMMAND",
        path: document.path,
        command,
        detail: `文档引用了不存在的脚本 pnpm ${command}`,
      });
    }
  }

  return commandCount;
}

/** 审计贡献者测试矩阵；纯函数，不读取文件系统。 */
export function auditTestMatrix(input: TestMatrixInput): TestMatrixReport {
  const areas = input.areas ?? TEST_MATRIX;
  const issues: TestMatrixIssue[] = [];
  let commandCount = 0;

  if (input.documents.length === 0) {
    issues.push({ code: "MATRIX_SOURCE_EMPTY", path: "-", detail: "没有传入需要校验的矩阵文档" });
  }
  for (const document of input.documents) {
    commandCount += auditDocument(document, areas, input.scripts, issues);
  }

  return { issues, areas: areas.length, commands: commandCount };
}

/** 格式化为带规则码的文本，供 CLI 和测试复用。 */
export function formatTestMatrixIssues(issues: readonly TestMatrixIssue[]): string {
  return issues.map((item) => `❌ [${item.code}] ${item.path} ${item.detail}`).join("\n");
}
