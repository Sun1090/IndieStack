/**
 * 设计 token 单一事实源（G02）。
 *
 * 背景：`src/app/globals.css` 的 `:root` / `.dark` 定义原始 CSS 变量，`@theme inline` 再把它们
 * 映射成 Tailwind 工具类可消费的 `--color-*`。两处靠人工保持同步，历史上已经出现过
 * 「`:root` 里定义了 `--chart-*`，但 `@theme` 没有映射，于是 `text-chart-1` 根本不存在」的缺口。
 *
 * 本模块把 token 清单抽成显式注册表，并给出纯函数审计：
 *   1. 注册表里的每个 token 必须真的定义在 `:root`；
 *   2. 标记 `dark: true` 的 token 必须在 `.dark` 里有覆盖（否则深色模式下不可读）；
 *   3. 标记 `utility: true` 的 token 必须有对应的 `--color-*` 映射（否则工具类不存在）；
 *   4. 每条 `--color-*` 映射引用的变量必须真的存在（防拼写错误 / 删变量不删映射）；
 *   5. `@theme` 里不得出现未登记进注册表的 `--color-*`（保持单一事实源）；
 *   6. 应用层不得用 Tailwind 原生调色板表达状态语义（必须走 success/warning/info/destructive），
 *      装饰性多色调色板（头像底色、分类徽标、统计卡）走显式白名单。
 *
 * 门禁不校验像素结果，视觉回归仍由 `pnpm test:visual` 负责。
 */

/** 语义分组，用于生成文档与聚合统计。 */
export type DesignTokenGroup = "surface" | "status" | "chart" | "sidebar" | "radius";

export interface DesignToken {
  /** CSS 变量基名（不含开头 `--`），例如 `background`、`chart-1`、`success`。 */
  name: string;
  /** 语义分组。 */
  group: DesignTokenGroup;
  /** 是否应该有 `--color-*` 映射（即能否作为 Tailwind 工具类消费）。 */
  utility: boolean;
  /** `--color-*` 映射名；缺省与 `name` 相同。仅 `utility: true` 时有意义。 */
  utilityName?: string;
  /** 是否必须在 `.dark` 里有覆盖值。 */
  dark: boolean;
}

/** shadcn 语义色（表面 / 文本 / 边框 / 交互态），全部需要深色覆盖与工具类映射。 */
const SURFACE_TOKENS = [
  "border",
  "input",
  "ring",
  "background",
  "foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "destructive",
  "destructive-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "popover",
  "popover-foreground",
  "card",
  "card-foreground",
] as const;

/**
 * 状态语义色（G02 新增）。
 *
 * 此前状态提示直接写 Tailwind 调色板（`bg-green-500` / `text-amber-600` / `bg-red-500`），
 * 同一个语义在不同文件里选了不同色阶，深色模式下也没有统一回退。收口成 4 组语义 token：
 * `success` / `warning` / `info` / `destructive`（destructive 复用 shadcn 既有定义）。
 */
const STATUS_TOKENS = [
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "info",
  "info-foreground",
] as const;

/** 图表色板，供 Recharts 等以 CSS 变量消费。 */
const CHART_TOKENS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;

/** 侧边栏专用色板；`--sidebar-background` 映射成 `--color-sidebar`（历史命名，不改以免破坏现有用法）。 */
const SIDEBAR_TOKENS: readonly [name: string, utilityName: string][] = [
  ["sidebar-background", "sidebar"],
  ["sidebar-foreground", "sidebar-foreground"],
  ["sidebar-primary", "sidebar-primary"],
  ["sidebar-primary-foreground", "sidebar-primary-foreground"],
  ["sidebar-accent", "sidebar-accent"],
  ["sidebar-accent-foreground", "sidebar-accent-foreground"],
  ["sidebar-border", "sidebar-border"],
  ["sidebar-ring", "sidebar-ring"],
];

function colorToken(name: string, group: DesignTokenGroup, utilityName?: string): DesignToken {
  return { name, group, utility: true, utilityName, dark: true };
}

/** 全部已登记的设计 token。新增 token 必须同时登记到这里与 `globals.css`。 */
export const DESIGN_TOKENS: DesignToken[] = [
  ...SURFACE_TOKENS.map((name) => colorToken(name, "surface")),
  ...STATUS_TOKENS.map((name) => colorToken(name, "status")),
  ...CHART_TOKENS.map((name) => colorToken(name, "chart")),
  ...SIDEBAR_TOKENS.map(([name, utility]) => colorToken(name, "sidebar", utility)),
  // radius 只驱动圆角刻度（--radius-lg/md/sm），没有颜色工具类，也不随明暗切换。
  { name: "radius", group: "radius", utility: false, dark: false },
];

/** 需要 `--color-*` 映射的 token（`--color-<utilityName>` → 原始变量名）。 */
export const THEME_COLOR_TOKENS: { token: string; colorVar: string; source: string }[] =
  DESIGN_TOKENS.filter((token) => token.utility).map((token) => ({
    token: `--color-${token.utilityName ?? token.name}`,
    colorVar: `--${token.name}`,
    source: token.name,
  }));

/**
 * 应用层禁止直接使用的「状态调色板」。这些色系的语义应由 success/warning/info/destructive 承载，
 * 避免同一语义在不同文件里漂移成不同色阶。
 */
export const STATUS_PALETTE_FAMILIES = [
  "red",
  "green",
  "emerald",
  "amber",
  "yellow",
  "orange",
  "blue",
  "sky",
] as const;

const PALETTE_UTILITY_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "from",
  "via",
  "to",
  "fill",
  "stroke",
  "outline",
  "decoration",
  "divide",
  "placeholder",
  "caret",
  "accent",
] as const;

/** 允许多色调色板的装饰性文件：头像底色、分类徽标、统计卡与色板示例。 */
export const STATUS_PALETTE_ALLOWLIST: readonly string[] = [
  "src/components/shared/initial-avatar.tsx",
  "src/app/(marketing)/changelog/page.tsx",
  "src/app/dashboard/admin/page.tsx",
];

const RAW_PALETTE_PATTERN = new RegExp(
  `(?:^|[\\s"'\\x60:(])((?:(?:dark|light|hover|focus|active|group-hover|focus-visible):)*` +
    `(?:${PALETTE_UTILITY_PREFIXES.join("|")})-(?:${STATUS_PALETTE_FAMILIES.join("|")})-\\d{2,3})\\b`,
  "g",
);

export interface TokenIssue {
  code: string;
  file: string;
  line?: number;
  message: string;
}

export interface TokenAuditInput {
  /** `src/app/globals.css` 内容。 */
  css: string;
  /** 应用层文件（已排除 `src/components/ui/**` 与测试）。 */
  sourceFiles: { path: string; content: string }[];
  /** 覆盖装饰性调色板白名单（测试用）。 */
  allowlist?: readonly string[];
}

export interface TokenAuditReport {
  errors: TokenIssue[];
  warnings: TokenIssue[];
  stats: {
    registered: number;
    rootDeclared: number;
    darkOverridden: number;
    colorMappings: number;
    scannedFiles: number;
  };
}

/** 转义正则元字符，供选择器查找使用。 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 返回 `openIndex`（`{` 的下标）对应的配对 `}` 下标；找不到返回 -1。 */
export function braceMatch(text: string, openIndex: number): number {
  if (text[openIndex] !== "{") return -1;
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 取出某个选择器/at-rule 的规则体；不存在或括号不配对时返回 null。 */
export function extractRuleBody(css: string, selector: string): string | null {
  const pattern = new RegExp(`(?:^|[}\\n;])\\s*${escapeRegExp(selector)}\\s*\\{`, "m");
  const match = pattern.exec(css);
  if (!match) return null;
  const openIndex = css.indexOf("{", match.index);
  const closeIndex = braceMatch(css, openIndex);
  if (closeIndex < 0) return null;
  return css.slice(openIndex + 1, closeIndex);
}

/** 从规则体中提取 `--name: value;` 声明（跳过嵌套块里的普通属性）。 */
export function extractDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  const pattern = /--([a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
}

/** 从任意声明值里提取引用的 CSS 变量名（不含 `--`）。 */
export function extractVarReferences(value: string): string[] {
  const references: string[] = [];
  const pattern = /var\(\s*--([a-zA-Z0-9-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) references.push(match[1]);
  return references;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) if (content[i] === "\n") line += 1;
  return line;
}

function pushIssue(
  list: TokenIssue[],
  code: string,
  file: string,
  message: string,
  line?: number,
): void {
  list.push(line === undefined ? { code, file, message } : { code, file, line, message });
}

/** 收集规则 1/2：注册表里的 token 必须存在于 :root，dark token 必须有 .dark 覆盖。 */
function auditRegistryTokens(
  errors: TokenIssue[],
  cssFile: string,
  rootDeclarations: Map<string, string>,
  darkDeclarations: Map<string, string>,
): void {
  for (const token of DESIGN_TOKENS) {
    if (!rootDeclarations.has(token.name)) {
      pushIssue(
        errors,
        "TOKEN_MISSING_ROOT",
        cssFile,
        `注册表登记的 --${token.name}（${token.group}）未在 :root 定义`,
      );
    }
    if (token.dark && !darkDeclarations.has(token.name)) {
      pushIssue(
        errors,
        "TOKEN_MISSING_DARK",
        cssFile,
        `--${token.name} 标记了 dark: true，但 .dark 没有覆盖值（深色模式下会沿用浅色值）`,
      );
    }
  }
}

/** 收集规则 3/4/5：@theme 映射的完整性、引用有效性与登记状态。 */
function auditThemeMappings(
  errors: TokenIssue[],
  cssFile: string,
  colorMappings: Map<string, string>,
  knownVariables: Set<string>,
): void {
  for (const { token, source } of THEME_COLOR_TOKENS) {
    if (colorMappings.has(token.slice(2))) continue;
    pushIssue(
      errors,
      "THEME_MAPPING_MISSING",
      cssFile,
      `${token} 缺失：--${source} 已定义但没有 @theme 映射，对应的 Tailwind 工具类不存在`,
    );
  }

  const registeredMappings = new Set(THEME_COLOR_TOKENS.map((entry) => entry.token));
  for (const [name, value] of colorMappings) {
    for (const reference of extractVarReferences(value)) {
      if (knownVariables.has(reference)) continue;
      pushIssue(
        errors,
        "THEME_MAPPING_DANGLING",
        cssFile,
        `--${name} 引用了未定义的 var(--${reference})（拼写错误或变量已删除）`,
      );
    }
    if (!registeredMappings.has(`--${name}`)) {
      pushIssue(
        errors,
        "THEME_MAPPING_UNREGISTERED",
        cssFile,
        `--${name} 未登记进 src/lib/design/tokens.ts 的 DESIGN_TOKENS，请先登记再映射`,
      );
    }
  }
}

/** 收集规则 6：应用层不得用原生调色板表达状态语义。 */
function auditPaletteUsage(
  errors: TokenIssue[],
  sourceFiles: TokenAuditInput["sourceFiles"],
  allowlist: readonly string[],
): void {
  for (const file of sourceFiles) {
    if (allowlist.includes(file.path)) continue;
    RAW_PALETTE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = RAW_PALETTE_PATTERN.exec(file.content)) !== null) {
      pushIssue(
        errors,
        "RAW_STATUS_PALETTE",
        file.path,
        `状态语义请用 success/warning/info/destructive token，而不是原生调色板类名（${match[1]}）`,
        lineOf(file.content, match.index),
      );
    }
  }
}

/**
 * 审计设计 token 一致性。
 *
 * `file` 一律用仓库相对路径，方便 CI annotation 与单测断言。
 */
export function auditDesignTokens(input: TokenAuditInput): TokenAuditReport {
  const { css, sourceFiles } = input;
  const allowlist = input.allowlist ?? STATUS_PALETTE_ALLOWLIST;
  const errors: TokenIssue[] = [];
  const warnings: TokenIssue[] = [];
  const cssFile = "src/app/globals.css";

  const rootBody = extractRuleBody(css, ":root");
  const darkBody = extractRuleBody(css, ".dark");
  const themeBody = extractRuleBody(css, "@theme inline");
  if (!rootBody)
    pushIssue(errors, "TOKEN_ROOT_BLOCK_MISSING", cssFile, "globals.css 里找不到 :root 规则块");
  if (!themeBody) {
    pushIssue(
      errors,
      "TOKEN_THEME_BLOCK_MISSING",
      cssFile,
      "globals.css 里找不到 @theme inline 规则块",
    );
  }

  const rootDeclarations = rootBody ? extractDeclarations(rootBody) : new Map<string, string>();
  const darkDeclarations = darkBody ? extractDeclarations(darkBody) : new Map<string, string>();
  const themeDeclarations = themeBody ? extractDeclarations(themeBody) : new Map<string, string>();
  const colorMappings = new Map<string, string>();
  for (const [name, value] of themeDeclarations) {
    if (name.startsWith("color-")) colorMappings.set(name, value);
  }

  auditRegistryTokens(errors, cssFile, rootDeclarations, darkDeclarations);
  const knownVariables = new Set([...rootDeclarations.keys(), ...themeDeclarations.keys()]);
  auditThemeMappings(errors, cssFile, colorMappings, knownVariables);
  auditPaletteUsage(errors, sourceFiles, allowlist);

  return {
    errors,
    warnings,
    stats: {
      registered: DESIGN_TOKENS.length,
      rootDeclared: rootDeclarations.size,
      darkOverridden: darkDeclarations.size,
      colorMappings: colorMappings.size,
      scannedFiles: sourceFiles.length,
    },
  };
}

/** 把问题列表格式化成多行文本（供 CLI 与单测断言）。 */
export function formatDesignTokenIssues(level: "error" | "warning", issues: TokenIssue[]): string {
  const icon = level === "error" ? "❌" : "⚠️";
  return issues
    .map(
      (issue) =>
        `${icon} [${issue.code}] ${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.message}`,
    )
    .join("\n");
}
