/**
 * Server Action 错误键的翻译完整性审计（D02 / D03）
 *
 * `src/lib/types/action-result.ts` 写明了约定：失败时 `error` 是 i18n 错误键，
 * 客户端经 `ta(error)` 翻译。但 `fail(error: string)` 是 `string`，TypeScript 帮不上忙，
 * 于是有两类退化没有任何机制能发现：
 *
 *   1. Action 新返回一个错误码，而 `messages/<locale>/actions.json` 里没有对应键
 *      ——`next-intl` 对缺失键的表现是把键名原样吐出来（并在静态生成时抛 `MISSING_MESSAGE`），
 *      所以「未翻译」在界面上长得像「翻译成功了」；
 *   2. 组件直接把 `result.error` 当文案渲染，绕过 `ta()`——用户于是看到
 *      `projectNotFound` 这种内部码（本次审计在 4 个调用点抓到实例）。
 *
 * 因此本模块把这两件事变成可执行规则：
 *
 *   - 从 Action / service / schema 源码里提取所有可产出的错误码（`fail("code")`、
 *     `fail(expr ?? "code")`、zod 校验器的末位字符串实参）；
 *   - 每个错误码必须在**每个** locale 的 `actions.json` 里存在，且各 locale 文案不得
 *     逐字相同（品牌/占位符例外须登记理由）；
 *   - 组件里把 `*.error` / `*.message` 直接作为展示文本的写法必须经 `ta()`，
 *     例外同样要登记理由；
 *   - 提取不到任何错误码即失败封闭——扫描范围写错不能伪装成「零问题」；
 *   - 登记的例外若已经不再需要，同样失败，避免例外清单只增不减。
 */

import ts from "typescript";

/** 错误码所在的消息命名空间与文件。 */
export const ACTION_ERROR_NAMESPACE = "actions";
export const ACTION_ERROR_MESSAGE_FILE = (locale: string): string =>
  `messages/${locale}/actions.json`;

/** 支持的语言（与 `src/i18n/routing.ts` 一致，由 IO 层传入以保持单向依赖）。 */
export const DEFAULT_ACTION_ERROR_LOCALES = ["en", "zh-CN"] as const;

/**
 * zod 校验器中「末位字符串实参即错误键」的方法名。
 * 只列真正会带 message 的，避免把 `z.string()` 之类误判为错误码。
 */
export const ZOD_MESSAGE_METHODS = new Set([
  "min",
  "max",
  "length",
  "email",
  "url",
  "regex",
  "trim",
  "startsWith",
  "endsWith",
  "includes",
  "minLength",
  "maxLength",
  "int",
  "finite",
  "gt",
  "gte",
  "lt",
  "lte",
  "positive",
  "negative",
  "refine",
  "superRefine",
  "transform",
]);

/** 可能承载用户可见文案的对象属性名。 */
export const DISPLAY_PROPERTY_NAMES = new Set([
  "title",
  "description",
  "message",
  "label",
  "content",
]);

/** 被视为「直接渲染错误码」的属性尾名。 */
export const RAW_ERROR_PROPERTY_NAMES = new Set(["error", "message"]);

/**
 * 返回「错误码字符串」而不是「已翻译文案」的辅助函数。
 *
 * `authErrorKey()` 的返回值本身就是 `actions` 命名空间的键，所以调用点必须再套一层
 * `ta(...)`——仓库里 8 个调用点都是 `ta(authErrorKey(err))`，只有 MFA 页两处漏了，
 * 用户看到的字面量就是 `authMfaFailed`。静态上无法从「返回 string」推断「返回键」，
 * 因此这里显式登记；新增此类 helper 时必须一并登记，否则等于给门禁开洞。
 */
export const KEY_PRODUCING_HELPERS = new Set(["authErrorKey"]);

/** 产出 `ActionResult` 的构造器所在模块（按路径后缀识别，兼容别名导入）。 */
export const ACTION_RESULT_MODULE_SUFFIX = "types/action-result";
/** zod 模块后缀：只有真正用 zod 校验的文件，其校验器消息才是错误码。 */
export const ZOD_MODULE_SUFFIX = "zod";

/** 错误码形状：小写开头的驼峰标识符（`projectNotFound`、`invalidInput`）。 */
const CODE_PATTERN = /^[a-z][A-Za-z0-9]*$/;

export interface ActionErrorSource {
  /** 仓库相对 POSIX 路径。 */
  fileName: string;
  content: string;
}

export type ActionErrorIssueCode =
  | "ACTION_ERROR_KEY_MISSING"
  | "ACTION_ERROR_VALUE_NOT_TRANSLATED"
  | "ACTION_ERROR_RAW_DISPLAY"
  | "ACTION_ERROR_UNTRANSLATED_KEY"
  | "ACTION_ERROR_STALE_EXEMPTION"
  | "ACTION_ERROR_NO_PRODUCER_CODES"
  | "ACTION_ERROR_MESSAGE_FILE_INVALID";

export interface ActionErrorIssue {
  code: ActionErrorIssueCode;
  file: string;
  line: number | null;
  message: string;
}

export interface ActionErrorInput {
  /** 可能产出错误码的源码（Server Action、被 Action 复用的 service / schema）。 */
  producers: readonly ActionErrorSource[];
  /** 会把错误码渲染给用户的前端源码。 */
  consumers: readonly ActionErrorSource[];
  /** locale → `messages/<locale>/actions.json` 的原始内容。 */
  messages: Readonly<Record<string, string>>;
  locales?: readonly string[];
  /** 逐字相同文案的例外：错误码 → 理由（品牌名、占位符等）。 */
  identicalValueExemptions?: Readonly<Record<string, string>>;
  /** 允许直接渲染错误码的文件：仓库相对路径 → 理由。 */
  rawDisplayExemptions?: Readonly<Record<string, string>>;
}

export interface ActionErrorReport {
  issues: ActionErrorIssue[];
  /** 提取到的错误码（排序）。 */
  codes: string[];
  /** 每个 locale 的键数量。 */
  keyCounts: Record<string, number>;
  /** 命中原始渲染的调用点数（含被豁免的）。 */
  rawDisplaySites: Array<{ file: string; line: number }>;
  exemptedRawFiles: string[];
  exemptedIdenticalCodes: string[];
}

function lineOf(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function parse(fileName: string, content: string): ts.SourceFile {
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function methodName(expression: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isIdentifier(expression)) return expression.text;
  return null;
}

function isCodeLike(value: string): boolean {
  return CODE_PATTERN.test(value);
}

/** 文件里从某个模块导入的本地绑定名（含 `import { fail as f }` 的别名）。 */
function importedLocalNames(sourceFile: ts.SourceFile, moduleSuffix: string, exported: string): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.endsWith(moduleSuffix)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === exported) names.add(element.name.text);
    }
  }
  return names;
}

/** 文件是否从某后缀模块导入过任意绑定。 */
function importsFrom(sourceFile: ts.SourceFile, moduleSuffix: string): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.endsWith(moduleSuffix),
  );
}

function literalString(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

interface ProducerContext {
  sourceFile: ts.SourceFile;
  /** 本文件里 `fail` 的本地名（兼容 `import { fail as failAction }`）。 */
  failNames: ReadonlySet<string>;
  /** 只有真正导入 zod 的文件，其校验器末位字符串才是错误码。 */
  usesZod: boolean;
}

function codeEntry(sourceFile: ts.SourceFile, node: ts.Node, code: string): { code: string; line: number } {
  return { code, line: lineOf(sourceFile, node.getStart(sourceFile)) };
}

/** 单个调用表达式产出的错误码：`fail("code")`、`fail(expr ?? "code")`、`z.string().min(1, "code")`。 */
function codesFromCall(node: ts.CallExpression, context: ProducerContext): Array<{ code: string; line: number }> {
  const { sourceFile, failNames, usesZod } = context;
  const name = methodName(node.expression);
  const last = node.arguments[node.arguments.length - 1];
  if (name === null || last === undefined) return [];

  const literal = literalString(last);
  const isFail = failNames.has(name);
  const found: Array<{ code: string; line: number }> = [];

  if ((isFail || (usesZod && ZOD_MESSAGE_METHODS.has(name))) && literal !== null && isCodeLike(literal)) {
    found.push(codeEntry(sourceFile, last, literal));
  }

  // 兜底文案同样会到达用户：fail(validated.error.issues[0]?.message ?? "invalidInput")
  if (
    isFail &&
    ts.isBinaryExpression(last) &&
    last.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  ) {
    const fallback = literalString(last.right);
    if (fallback !== null && isCodeLike(fallback)) found.push(codeEntry(sourceFile, last.right, fallback));
  }

  return found;
}

/** 从一个源码文件里提取所有可产出的 i18n 错误码。 */
export function collectActionErrorCodes(
  source: ActionErrorSource,
): Array<{ code: string; line: number }> {
  const sourceFile = parse(source.fileName, source.content);
  const failNames = importedLocalNames(sourceFile, ACTION_RESULT_MODULE_SUFFIX, "fail");
  const usesZod = importsFrom(sourceFile, ZOD_MODULE_SUFFIX);
  if (failNames.size === 0 && !usesZod) return [];

  const context: ProducerContext = { sourceFile, failNames, usesZod };
  const found: Array<{ code: string; line: number }> = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) found.push(...codesFromCall(node, context));
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

/**
 * 找出把错误码不经翻译直接作为展示文案的写法。
 *
 * 两类：`description: result.error`（ActionResult 的错误码）与
 * `description: authErrorKey(err)`（返回键的 helper）。后者必须靠 `KEY_PRODUCING_HELPERS`
 * 登记，因为静态上它和返回文案的函数没有区别。
 */
export function collectRawErrorDisplays(
  source: ActionErrorSource,
): Array<{ line: number; text: string; untranslatedKey: boolean }> {
  const sourceFile = parse(source.fileName, source.content);
  const found: Array<{ line: number; text: string; untranslatedKey: boolean }> = [];

  const helperNames = new Set<string>();
  for (const helper of KEY_PRODUCING_HELPERS) {
    for (const local of importedLocalNames(sourceFile, "auth/errors", helper)) helperNames.add(local);
  }

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const site = rawDisplayFromProperty(node, sourceFile, helperNames);
      if (site) found.push(site);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

interface RawDisplaySite {
  line: number;
  text: string;
  untranslatedKey: boolean;
}

/** 展示属性里直接把错误码当文案的写法；不匹配时返回 null。 */
function rawDisplayFromProperty(
  node: ts.PropertyAssignment,
  sourceFile: ts.SourceFile,
  helperNames: ReadonlySet<string>,
): RawDisplaySite | null {
  const key = ts.isIdentifier(node.name)
    ? node.name.text
    : ts.isStringLiteral(node.name)
      ? node.name.text
      : null;
  if (key === null || !DISPLAY_PROPERTY_NAMES.has(key)) return null;

  const initializer = node.initializer;
  const rawProperty =
    ts.isPropertyAccessExpression(initializer) &&
    RAW_ERROR_PROPERTY_NAMES.has(initializer.name.text) &&
    !ts.isCallExpression(initializer.expression);
  const untranslatedHelper =
    ts.isCallExpression(initializer) &&
    ts.isIdentifier(initializer.expression) &&
    helperNames.has(initializer.expression.text);
  if (!rawProperty && !untranslatedHelper) return null;

  const suffix = untranslatedHelper ? " 返回的是错误码" : "";
  return {
    line: lineOf(sourceFile, initializer.getStart(sourceFile)),
    text: `${key}: ${initializer.getText(sourceFile)}${suffix}`,
    untranslatedKey: untranslatedHelper,
  };
}

interface ParsedMessages {
  keys: Map<string, string>;
  error: string | null;
}

function parseActionMessages(fileName: string, content: string): ParsedMessages {
  try {
    const raw: unknown = JSON.parse(content);
    const keys = new Map<string, string>();
    const walk = (value: unknown, prefix: string): void => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          walk(child, prefix ? `${prefix}.${key}` : key);
        }
        return;
      }
      keys.set(prefix, typeof value === "string" ? value : JSON.stringify(value ?? null));
    };
    walk(raw, "");
    return { keys, error: null };
  } catch (error) {
    return { keys: new Map(), error: error instanceof Error ? error.message : String(error) };
  }
}

type LocaleMessages = ReadonlyMap<string, ParsedMessages>;

/** 加载每个 locale 的 `actions.json`；缺失或损坏直接记为问题。 */
function loadLocaleMessages(
  locales: readonly string[],
  messages: Readonly<Record<string, string>>,
  issues: ActionErrorIssue[],
): LocaleMessages {
  const loaded = new Map<string, ParsedMessages>();
  for (const locale of locales) {
    const fileName = ACTION_ERROR_MESSAGE_FILE(locale);
    const content = messages[locale];
    if (content === undefined) {
      issues.push({
        code: "ACTION_ERROR_MESSAGE_FILE_INVALID",
        file: fileName,
        line: null,
        message: `缺少 ${locale} 的 ${ACTION_ERROR_NAMESPACE} 消息文件内容`,
      });
      loaded.set(locale, { keys: new Map(), error: "missing" });
      continue;
    }
    const parsed = parseActionMessages(fileName, content);
    if (parsed.error) {
      issues.push({
        code: "ACTION_ERROR_MESSAGE_FILE_INVALID",
        file: fileName,
        line: null,
        message: `无法解析 JSON：${parsed.error}`,
      });
    }
    loaded.set(locale, parsed);
  }
  return loaded;
}

/** 每个错误码必须在每个 locale 有键，且各 locale 文案不得逐字相同（除非登记理由）。 */
function checkCodeTranslations(
  codes: readonly string[],
  origins: ReadonlyMap<string, { file: string; line: number }>,
  messages: LocaleMessages,
  locales: readonly string[],
  identicalExemptions: Readonly<Record<string, string>>,
): ActionErrorIssue[] {
  const issues: ActionErrorIssue[] = [];
  for (const code of codes) {
    const origin = origins.get(code);
    for (const locale of locales) {
      if (messages.get(locale)?.keys.has(code)) continue;
      issues.push({
        code: "ACTION_ERROR_KEY_MISSING",
        file: ACTION_ERROR_MESSAGE_FILE(locale),
        line: null,
        message: `错误码 "${code}"（${origin?.file}:${origin?.line} 产出）缺少 ${locale} 文案`,
      });
    }

    const values = locales
      .map((locale) => messages.get(locale)?.keys.get(code))
      .filter((value): value is string => typeof value === "string");
    const identical =
      values.length === locales.length && locales.length > 1 && values.every((value) => value === values[0]);
    if (identical && !Object.hasOwn(identicalExemptions, code)) {
      issues.push({
        code: "ACTION_ERROR_VALUE_NOT_TRANSLATED",
        file: ACTION_ERROR_MESSAGE_FILE(locales[1] ?? locales[0]),
        line: null,
        message: `错误码 "${code}" 在所有 locale 逐字相同（${JSON.stringify(values[0])}），疑似漏翻译`,
      });
    }
  }
  return issues;
}

interface RawDisplayFindings {
  issues: ActionErrorIssue[];
  sites: Array<{ file: string; line: number }>;
  files: Set<string>;
}

/** 前端调用点是否把错误码原样渲染给用户。 */
function checkRawDisplays(
  consumers: readonly ActionErrorSource[],
  rawExemptions: Readonly<Record<string, string>>,
): RawDisplayFindings {
  const issues: ActionErrorIssue[] = [];
  const sites: Array<{ file: string; line: number }> = [];
  const files = new Set<string>();
  for (const source of consumers) {
    for (const site of collectRawErrorDisplays(source)) {
      sites.push({ file: source.fileName, line: site.line });
      files.add(source.fileName);
      if (Object.hasOwn(rawExemptions, source.fileName)) continue;
      issues.push({
        code: site.untranslatedKey ? "ACTION_ERROR_UNTRANSLATED_KEY" : "ACTION_ERROR_RAW_DISPLAY",
        file: source.fileName,
        line: site.line,
        message: site.untranslatedKey
          ? `${site.text}，需再经 ta(...) 翻译后才能展示`
          : `${site.text} 直接把错误码当文案渲染，应改为 ta(...) 翻译`,
      });
    }
  }
  return { issues, sites, files };
}

/** 两条例外清单都必须仍然成立，避免例外只增不减。 */
function checkStaleExemptions(
  rawExemptions: Readonly<Record<string, string>>,
  identicalExemptions: Readonly<Record<string, string>>,
  findings: RawDisplayFindings,
  codes: readonly string[],
  messages: LocaleMessages,
  locales: readonly string[],
): ActionErrorIssue[] {
  const issues: ActionErrorIssue[] = [];
  for (const file of Object.keys(rawExemptions).sort()) {
    if (!findings.files.has(file)) {
      issues.push({
        code: "ACTION_ERROR_STALE_EXEMPTION",
        file,
        line: null,
        message: "登记的原始错误码渲染豁免已不再需要，请删除该条目",
      });
    }
  }
  for (const code of Object.keys(identicalExemptions).sort()) {
    const stillNeeded =
      codes.includes(code) && locales.some((locale) => messages.get(locale)?.keys.has(code));
    if (!stillNeeded) {
      issues.push({
        code: "ACTION_ERROR_STALE_EXEMPTION",
        file: ACTION_ERROR_MESSAGE_FILE(locales[0] ?? "en"),
        line: null,
        message: `登记的 "${code}" 同值豁免已不再需要（错误码或消息键已不存在）`,
      });
    }
  }
  return issues;
}

/** 执行完整审计，返回问题清单与统计。 */
export function auditActionErrorTranslation(input: ActionErrorInput): ActionErrorReport {
  const locales = [...(input.locales ?? DEFAULT_ACTION_ERROR_LOCALES)];
  const identicalExemptions = input.identicalValueExemptions ?? {};
  const rawExemptions = input.rawDisplayExemptions ?? {};
  const issues: ActionErrorIssue[] = [];

  const produced = input.producers.flatMap((source) =>
    collectActionErrorCodes(source).map((entry) => ({ ...entry, file: source.fileName })),
  );
  const codes = [...new Set(produced.map((entry) => entry.code))].sort();
  const origins = new Map<string, { file: string; line: number }>();
  for (const entry of produced) {
    if (!origins.has(entry.code)) origins.set(entry.code, entry);
  }

  const messages = loadLocaleMessages(locales, input.messages, issues);

  if (codes.length === 0) {
    issues.push({
      code: "ACTION_ERROR_NO_PRODUCER_CODES",
      file: input.producers[0]?.fileName ?? "(none)",
      line: null,
      message: `未从 ${input.producers.length} 个产出侧文件中提取到任何错误码，扫描范围或提取规则已失效`,
    });
  }

  issues.push(...checkCodeTranslations(codes, origins, messages, locales, identicalExemptions));
  const findings = checkRawDisplays(input.consumers, rawExemptions);
  issues.push(...findings.issues);
  issues.push(...checkStaleExemptions(rawExemptions, identicalExemptions, findings, codes, messages, locales));

  const keyCounts: Record<string, number> = {};
  for (const locale of locales) keyCounts[locale] = messages.get(locale)?.keys.size ?? 0;

  return {
    issues,
    codes,
    keyCounts,
    rawDisplaySites: findings.sites,
    exemptedRawFiles: Object.keys(rawExemptions).filter((file) => findings.files.has(file)).sort(),
    exemptedIdenticalCodes: Object.keys(identicalExemptions)
      .filter((code) => codes.includes(code))
      .sort(),
  };
}

/** 把问题清单格式化为逐行文本，供 CLI 与测试共用。 */
export function formatActionErrorIssues(issues: readonly ActionErrorIssue[]): string[] {
  return issues.map(
    (issue) => `[${issue.code}] ${issue.file}${issue.line ? `:${issue.line}` : ""}：${issue.message}`,
  );
}
