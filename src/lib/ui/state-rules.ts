/**
 * 加载 / 空 / 错误状态门禁（G04）。
 *
 * 背景：G04 之前仓库里同时存在 `page-loader.tsx`、`loading-state.tsx` 两个零引用的加载组件，
 * 12 个 `loading.tsx` 里有 3 个绕过共享原语手写 Skeleton（漏了 `aria-busy`），
 * 10 处空态是裸 `<p className="py-8 text-center">`，错误态在 3 个错误边界里各写一套。
 * 现在三条状态语义各自只有一个落脚点：
 *
 *   - `src/components/shared/page-loading.tsx`（`PageLoading` / `LoadingIndicator`）
 *   - `src/components/shared/empty-state.tsx`（`EmptyState`）
 *   - `src/components/shared/error-state.tsx`（`ErrorState`）
 *
 * 本模块把这些约定变成可执行的纯函数审计，防止旧写法回潮：
 *   1. 每个 `src/app/**\/loading.tsx` 必须渲染共享 `PageLoading`（否则骨架屏会重新丢掉 aria）；
 *   2. 已删除的重复加载组件不得重新出现；
 *   3. 旋转指示器只允许出现在白名单文件里（其余场景走 LoadingIndicator）；
 *   4. 不得再写「居中 + 固定纵向内边距」的裸占位符（空态走 EmptyState、错误走 ErrorState）。
 *
 * 上游 shadcn 基元（`src/components/ui/**`）与状态原语自身不受约束——它们就是这些写法的
 * 唯一落脚点。门禁只管静态写法，运行时语义由 `page-loading.test.tsx` /
 * `empty-state.test.tsx` / `error-state.test.tsx` / `query-error-state.test.tsx` 覆盖。
 */

export type StateRuleCode =
  "RAW_ROUTE_SKELETON" | "LEGACY_LOADER_MODULE" | "RAW_SPINNER" | "BARE_PLACEHOLDER";

export interface StateIssue {
  code: StateRuleCode;
  /** 仓库相对路径。 */
  file: string;
  /** 1 起算的行号。 */
  line: number;
  message: string;
}

export interface StateAuditFile {
  path: string;
  content: string;
}

export interface StateAuditInput {
  /** 应用层文件（`src/app` + `src/components`，排除 `src/components/ui` 与测试）。 */
  sourceFiles: readonly StateAuditFile[];
  /** `src/app` 下所有 `loading.tsx`。 */
  routeLoadingFiles: readonly StateAuditFile[];
}

export interface StateAuditReport {
  errors: StateIssue[];
  stats: { scannedFiles: number; routeLoadingFiles: number };
}

/** 路由级加载骨架的唯一实现。 */
export const PAGE_LOADING_MODULE = "@/components/shared/page-loading";

/** 空态 / 错误态原语；它们自身允许出现裸占位符类名。 */
export const PLACEHOLDER_PRIMITIVES = [
  "src/components/shared/empty-state.tsx",
  "src/components/shared/error-state.tsx",
] as const;

/** 允许出现 `animate-spin` 的文件：加载原语，以及按钮内联 spinner。 */
export const SPINNER_ALLOWLIST = [
  "src/components/shared/page-loading.tsx",
  "src/components/shared/confirm-dialog.tsx",
] as const;

/** G04 删除的重复加载组件；重新出现即视为回退。 */
export const LEGACY_LOADER_MODULES = [
  "src/components/shared/page-loader.tsx",
  "src/components/shared/loading-state.tsx",
] as const;

/** 裸占位符标记：同一 className 里既有居中，又有固定纵向内边距。 */
export const PLACEHOLDER_ALIGN_TOKEN = "text-center";
export const PLACEHOLDER_PADDING_TOKENS = ["py-6", "py-8", "py-10", "py-12", "py-16"] as const;

const RULE_MESSAGES: Record<StateRuleCode, string> = {
  RAW_ROUTE_SKELETON:
    "路由级 loading.tsx 必须渲染 @/components/shared/page-loading 的 PageLoading，不要手写 Skeleton（会丢 aria-busy / role=status）",
  LEGACY_LOADER_MODULE:
    "该组件已在 G04 删除：加载态统一走 @/components/shared/page-loading（PageLoading / LoadingIndicator）",
  RAW_SPINNER:
    "旋转指示器请使用 @/components/shared/page-loading 的 LoadingIndicator（自带 role=status），或把文件加入 SPINNER_ALLOWLIST 并说明原因",
  BARE_PLACEHOLDER: `裸占位符请改用 EmptyState / ErrorState：不要在同一个 className 里同时写「${PLACEHOLDER_ALIGN_TOKEN}」与「${PLACEHOLDER_PADDING_TOKENS.join("/")}」（会漏掉 role=status/alert）`,
};

/** 计算字符下标所在行（1 起算）。 */
function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

/** 逐个匹配正则并把命中位置记成问题项；每次新建 RegExp，避免共享 lastIndex 状态。 */
function collectMatches(
  errors: StateIssue[],
  file: StateAuditFile,
  code: StateRuleCode,
  pattern: RegExp,
): void {
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(file.content)) !== null) {
    errors.push({
      code,
      file: file.path,
      line: lineOf(file.content, match.index),
      message: RULE_MESSAGES[code],
    });
  }
}

/** 返回文件中所有字符串字面量（含模板字符串）及其下标。 */
function stringLiterals(content: string): Array<{ value: string; index: number }> {
  const literals: Array<{ value: string; index: number }> = [];
  const pattern = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    literals.push({ value: match[1] ?? match[2] ?? match[3] ?? "", index: match.index });
  }
  return literals;
}

function auditLegacyModules(file: StateAuditFile, errors: StateIssue[]): void {
  if (!(LEGACY_LOADER_MODULES as readonly string[]).includes(file.path)) return;
  errors.push({
    code: "LEGACY_LOADER_MODULE",
    file: file.path,
    line: 1,
    message: RULE_MESSAGES.LEGACY_LOADER_MODULE,
  });
}

function auditSpinners(file: StateAuditFile, errors: StateIssue[]): void {
  if ((SPINNER_ALLOWLIST as readonly string[]).includes(file.path)) return;
  collectMatches(errors, file, "RAW_SPINNER", /animate-spin/g);
}

function auditBarePlaceholders(file: StateAuditFile, errors: StateIssue[]): void {
  if ((PLACEHOLDER_PRIMITIVES as readonly string[]).includes(file.path)) return;
  for (const literal of stringLiterals(file.content)) {
    if (!literal.value.includes(PLACEHOLDER_ALIGN_TOKEN)) continue;
    if (!PLACEHOLDER_PADDING_TOKENS.some((token) => literal.value.includes(token))) continue;
    errors.push({
      code: "BARE_PLACEHOLDER",
      file: file.path,
      line: lineOf(file.content, literal.index),
      message: RULE_MESSAGES.BARE_PLACEHOLDER,
    });
  }
}

function auditRouteLoading(file: StateAuditFile, errors: StateIssue[]): void {
  const usesPrimitive =
    file.content.includes(PAGE_LOADING_MODULE) && /<\s*PageLoading[\s/>]/.test(file.content);
  if (usesPrimitive) return;
  errors.push({
    code: "RAW_ROUTE_SKELETON",
    file: file.path,
    line: 1,
    message: RULE_MESSAGES.RAW_ROUTE_SKELETON,
  });
}

/** 审计状态写法；`file` 一律用仓库相对路径，便于 CI annotation 与单测断言。 */
export function auditStates(input: StateAuditInput): StateAuditReport {
  const errors: StateIssue[] = [];
  for (const file of input.sourceFiles) {
    auditLegacyModules(file, errors);
    auditSpinners(file, errors);
    auditBarePlaceholders(file, errors);
  }
  for (const file of input.routeLoadingFiles) auditRouteLoading(file, errors);
  return {
    errors,
    stats: {
      scannedFiles: input.sourceFiles.length,
      routeLoadingFiles: input.routeLoadingFiles.length,
    },
  };
}

/** 把问题列表格式化成多行文本（供 CLI 与单测断言）。 */
export function formatStateIssues(issues: readonly StateIssue[]): string {
  return issues
    .map((issue) => `❌ [${issue.code}] ${issue.file}:${issue.line} ${issue.message}`)
    .join("\n");
}
