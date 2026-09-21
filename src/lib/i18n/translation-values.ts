/**
 * 翻译完整性审计：看**值**而不是只看键（D02 / D03）
 *
 * `pnpm check:locales` 此前只比对 en 与 zh-CN 的键集合是否对称——键对齐了，值却可以是
 * 一整段英文。对中文用户来说，「漏翻译」和「翻译对了」在构建上是同一个颜色：
 * `settings.sections.security.title` 长期是 `"Security"`，而同级的 `danger` 分区早就翻成
 * 「危险区域」，没有任何门禁能区分这两者。
 *
 * 本模块补两条规则：
 *
 *   - **该 locale 的文字系统必须出现**：`zh-CN` 的文案里一个汉字都没有即视为漏翻译；
 *     品牌名、占位符、语言名一类确实不翻译的值必须**逐项登记理由**；
 *   - **值不得是一个内部标识符**：小写开头的驼峰单词（`projectNotFound`）出现在用户可见
 *     文案里，几乎总是「把错误码/键名当文案」的回声——`dashboard.projects.deleteProjectNotFound`
 *     的真实值就是 `"projectNotFound"`，而它零引用。
 *
 * 第二条只对有文字系统要求的 locale 生效：英文里的 `and` / `days` / `or` 是正常词，
 * 中文界面里出现裸驼峰 token 才是信号。
 *
 * 审计覆盖**字符串叶子**，包括消息数组里的内容：`home.statLabels`、`terms.sections[].content`、
 * `blog.posts[].title` 这类由 `t.raw()` 取出后直接渲染的文案占了营销页的全部正文，把数组当叶子
 * 丢弃就等于只审了一半。下标进入路径（`terms.sections.1.title`），因此登记项可以精确到字段名
 * （`zh-CN:blog.posts.*.slug`）而不会顺手放行同一个数组里的 `title`。
 *
 * 另外两条护栏：一个值都没抽到即失败封闭（glob 写错不能伪装成「零问题」）；
 * 登记的例外若已经不再需要同样失败，避免例外清单只增不减。
 * 新增 locale 时必须先在 `LOCALE_SCRIPT_REQUIREMENTS` 分类，否则它会被静默跳过。
 */

/**
 * 汉字码点：扩展 A（U+3400–U+4DBF）、基本区（U+4E00–U+9FFF）、兼容表意文字（U+F900–U+FAFF）。
 *
 * 必须写成显式码点而不是字面字符区间：`[豈-﫿]` 看起来是兼容表意文字区，实际起点是
 * U+8C48（「豈」的基本区同形字），于是整个谚文块 U+AC00–U+D7AF 落进区间——
 * `한국어` 会被判定为「含中文」而静默放行，规则形同失效。
 */
export const CJK_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

/**
 * 每个 locale 对文案文字系统的期望；`null` 表示「拉丁源语言，不要求任何文字」。
 *
 * **每个消息目录都必须在这里出现**：新增 `ko` / `ar` 而忘了登记，值审计就会静默跳过它，
 * 于是「加了新语言」看起来和「翻译完整」一模一样。
 */
export const LOCALE_SCRIPT_REQUIREMENTS: Readonly<Record<string, RegExp | null>> = {
  en: null,
  "zh-CN": CJK_PATTERN,
};

/** 形如内部标识符的值：小写字母开头的驼峰单词，不含空格或标点。 */
export const KEY_SHAPED_VALUE = /^[a-z][A-Za-z0-9]*$/;

export type TranslationValueIssueCode =
  | "I18N_VALUE_UNTRANSLATED"
  | "I18N_VALUE_KEY_LEAK"
  | "I18N_STALE_ALLOWLIST"
  | "I18N_LOCALE_NOT_CLASSIFIED"
  | "I18N_NO_MESSAGE_VALUES";

export interface TranslationValueIssue {
  code: TranslationValueIssueCode;
  /** `messages/<locale>/<namespace>.json` 或登记键。 */
  file: string;
  key: string;
  message: string;
}

export interface TranslationValueInput {
  /** locale → (namespace → `messages/<locale>/<namespace>.json` 的原始文本)。 */
  messages: Readonly<Record<string, Record<string, string>>>;
  /** `<locale>:<namespace>.<key>` → 不翻译的理由；路径段可用 `*` 匹配单个下标/字段名。 */
  allowlist?: Readonly<Record<string, string>>;
}

export interface TranslationValueReport {
  issues: TranslationValueIssue[];
  /** 参与审计的字符串值数量。 */
  checkedValues: number;
  /** 命中规则但已登记的键。 */
  exemptedKeys: string[];
}

function flatten(prefix: string, node: unknown, into: Map<string, string>): void {
  if (Array.isArray(node)) {
    // 数组里的每一项都是用户可见文案（`home.statLabels`、`terms.sections` 的 title/content），
    // 按下标展开成独立路径；把它们当叶子丢弃会让一半文案逃过审计。
    node.forEach((item, index) => flatten(prefix ? `${prefix}.${index}` : String(index), item, into));
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      flatten(prefix ? `${prefix}.${key}` : key, value, into);
    }
    return;
  }
  if (typeof node === "string") into.set(prefix, node);
}

export interface ParsedNamespace {
  fileName: string;
  values: Map<string, string>;
  error: string | null;
}

/** 解析单个消息文件，只保留字符串叶子（数组与对象按前缀展开）。 */
export function parseMessageNamespace(locale: string, namespace: string, content: string): ParsedNamespace {
  const fileName = `messages/${locale}/${namespace}.json`;
  try {
    const values = new Map<string, string>();
    flatten("", JSON.parse(content) as unknown, values);
    return { fileName, values, error: null };
  } catch (error) {
    return { fileName, values: new Map(), error: error instanceof Error ? error.message : String(error) };
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * 把登记键编译成匹配器：`*` 匹配**单个**路径段（数组下标或对象键）。
 *
 * 用于消息数组里的结构性字段（`blog.posts.*.slug`、`changelog.releases.*.changes.*.type`）——
 * 同一条规则要覆盖 20 个下标，但绝不能顺手放行同一数组里的 `title` / `text`。
 * 不支持跨段的 `**`：一次只想豁免一个字段名。
 */
function allowlistMatcher(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? "\u0000" : `\\${ch}`));
  return new RegExp(`^${escaped.replace(/\u0000/g, "[^.]+")}$`);
}

/** 查找命中的登记项；返回登记键与理由，未命中返回 undefined。 */
export function matchAllowlistEntry(
  allowlist: Readonly<Record<string, string>>,
  registrationKey: string,
): { pattern: string; reason: string } | undefined {
  for (const [pattern, reason] of Object.entries(allowlist)) {
    if (!isNonEmptyString(reason)) continue;
    if (pattern === registrationKey || allowlistMatcher(pattern).test(registrationKey)) {
      return { pattern, reason };
    }
  }
  return undefined;
}

/** 单个 locale 的值规则：文字系统缺失与内部标识符回声。 */
function checkLocaleValues(
  locale: string,
  parsedFiles: ReadonlyArray<{ namespace: string; parsed: ParsedNamespace }>,
  script: RegExp,
  allowlist: Readonly<Record<string, string>>,
  matchedPatterns: Set<string>,
  exemptedKeys: string[],
): TranslationValueIssue[] {
  const issues: TranslationValueIssue[] = [];
  for (const { namespace, parsed } of parsedFiles) {
    if (parsed.error) continue;
    for (const [key, value] of parsed.values) {
      const looksLikeKey = KEY_SHAPED_VALUE.test(value.trim());
      // 标识符形状优先判定：裸驼峰值必然也不含汉字，先判漏翻译会让更具体的那条规则永不可达。
      const missingScript = !looksLikeKey && !script.test(value);
      if (!missingScript && !looksLikeKey) continue;

      const registrationKey = `${locale}:${namespace}.${key}`;
      const hit = matchAllowlistEntry(allowlist, registrationKey);
      if (hit) {
        matchedPatterns.add(hit.pattern);
        exemptedKeys.push(registrationKey);
        continue;
      }
      issues.push({
        code: missingScript ? "I18N_VALUE_UNTRANSLATED" : "I18N_VALUE_KEY_LEAK",
        file: parsed.fileName,
        key: `${namespace}.${key}`,
        message: missingScript
          ? `值里没有任何该 locale 期望的文字（${JSON.stringify(value)}），疑似漏翻译；确实不翻译请登记理由`
          : `值是内部标识符形状（${JSON.stringify(value)}），像是把键名或错误码当文案`,
      });
    }
  }
  return issues;
}

/** 执行翻译值审计。 */
export function auditTranslationValues(input: TranslationValueInput): TranslationValueReport {
  const allowlist = input.allowlist ?? {};
  const issues: TranslationValueIssue[] = [];
  const exemptedKeys: string[] = [];
  const matchedPatterns = new Set<string>();
  let checkedValues = 0;

  for (const [locale, namespaces] of Object.entries(input.messages).sort((a, b) => a[0].localeCompare(b[0]))) {
    const parsedFiles = Object.entries(namespaces)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([namespace, content]) => ({
        namespace,
        parsed: parseMessageNamespace(locale, namespace, content),
      }));

    for (const { namespace, parsed } of parsedFiles) {
      if (parsed.error) {
        issues.push({
          code: "I18N_NO_MESSAGE_VALUES",
          file: parsed.fileName,
          key: namespace,
          message: `无法解析 JSON：${parsed.error}`,
        });
        continue;
      }
      checkedValues += parsed.values.size;
    }

    // 没登记期望不是「没问题」，而是会被静默跳过，所以要显式失败。
    if (!Object.hasOwn(LOCALE_SCRIPT_REQUIREMENTS, locale)) {
      issues.push({
        code: "I18N_LOCALE_NOT_CLASSIFIED",
        file: `messages/${locale}`,
        key: locale,
        message: "该 locale 未登记 LOCALE_SCRIPT_REQUIREMENTS，值审计会静默跳过它",
      });
      continue;
    }
    // 期望为 null 的是拉丁源语言：英文里的 `and` / `days` 是正常词，不是漏翻译。
    const script = LOCALE_SCRIPT_REQUIREMENTS[locale];
    if (script === null) continue;

    issues.push(
      ...checkLocaleValues(locale, parsedFiles, script, allowlist, matchedPatterns, exemptedKeys),
    );
  }

  if (checkedValues === 0) {
    issues.push({
      code: "I18N_NO_MESSAGE_VALUES",
      file: "messages",
      key: "*",
      message: "一个字符串消息都没抽到，扫描范围或解析规则已失效",
    });
  }

  // 例外清单只减不增：命中不到任何值的登记项（含通配字段）同样失败。
  for (const pattern of Object.keys(allowlist).sort()) {
    if (!matchedPatterns.has(pattern)) {
      issues.push({
        code: "I18N_STALE_ALLOWLIST",
        file: `messages/${pattern.slice(0, pattern.indexOf(":"))}`,
        key: pattern,
        message: "登记的不翻译例外已不再命中任何值，请删除该条目",
      });
    }
  }

  return { issues, checkedValues, exemptedKeys: exemptedKeys.sort() };
}

/** 逐行格式化，供 CLI 与测试共用。 */
export function formatTranslationValueIssues(issues: readonly TranslationValueIssue[]): string[] {
  return issues.map((issue) => `[${issue.code}] ${issue.file} · ${issue.key}：${issue.message}`);
}
