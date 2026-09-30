/**
 * next-intl 静态 missing-key 门禁的规则本体。
 *
 * 背景：这条门禁的判定逻辑原先内联在 `scripts/check-i18n-usage.js` 里（84 行），
 * 是当时 4 条「强度没有被单测兜底」的门禁之一。把它搬到这里不是为了形式统一，
 * 而是因为搬的过程中发现了两个**会让这条门禁静默变松**的洞——而 i18n 恰好是本仓库
 * 已经付过学费的领域（`AGENTS.md` 记着 2026-08-23 那次：漏一个 key，只有生产构建才炸）。
 *
 * 洞一：**别名遮蔽**。命名空间绑定收在 `Map<别名, 命名空间>` 里，于是同一个文件里
 * `const t = useTranslations("a")` 与 `const t = getTranslations("b")` 并存时，
 * 后者**静默覆盖**前者——于是按 `a` 写的那些调用会拿 `b` 去查，查不到就报红、
 * 查得到就当作已验证。两种结果都是编的。
 * 现在它是一条**明确的问题项**（`AMBIGUOUS_NAMESPACE_ALIAS`）：静态阶段判不出来的时候
 * 就说出来，而不是挑一个继续。
 *
 * 洞二：**别名未转义**。调用正则用 `\\b${alias}` 拼，而别名取自
 * `[A-Za-z_$][\w$]*`——**`$` 是合法的 JS 标识符字符**。正则里 `$` 表示「输入末尾」，
 * 所以 `const t$ = useTranslations("a")` 的正则永远匹配不到任何东西，
 * 它名下**所有**翻译调用被静默跳过。现在转义后再拼。
 *
 * 刻意保留的两处既有行为（都是对的，别顺手「优化」掉）：
 *   - 动态 key（模板字符串、变量）**跳过**而不是猜。注释原话：「无法在静态阶段可靠展开，
 *     交由 `t.has` 或运行时回退处理；它们会被明确跳过，而不是伪造为已验证。」
 *   - 命名空间必须是**字面量**才绑定；`useTranslations(ns)` 里的变量同样跳过。
 */

/** 一次翻译调用的命名空间。 */
export interface NamespaceBinding {
  alias: string;
  namespace: string;
}

export type TranslationUsageCode = "MISSING_KEY" | "AMBIGUOUS_NAMESPACE_ALIAS";

export interface TranslationUsageFile {
  /** 仓库相对路径。 */
  path: string;
  content: string;
}

export interface TranslationUsageInput {
  files: readonly TranslationUsageFile[];
  /** locale → 命名空间树。 */
  messages: Readonly<Record<string, unknown>>;
  /** 需要逐个核对的 locale。 */
  locales: readonly string[];
}

export interface TranslationUsageIssue {
  code: TranslationUsageCode;
  file: string;
  line: number;
  message: string;
}

export interface TranslationUsageReport {
  errors: TranslationUsageIssue[];
  stats: {
    scannedFiles: number;
    /** 静态核对过的翻译调用数（去重）。 */
    scannedCalls: number;
    boundNamespaces: number;
  };
}

/**
 * 去掉注释，**但保留换行**（行号是这条门禁的输出之一，去掉换行会让报错指错行）。
 *
 * 为什么需要：命名空间与调用的正则扫的是**原始文本**，而注释里写
 * `const t = useTranslations("a")` 这种示例是本仓库文档的常态（规则模块自己的文件头就是）。
 * 注释不是代码，扫进去就是**假红**——而这条门禁的假红不是「多查了一个 key」那么轻：
 * 它会让人开始习惯性地忽略输出。
 *
 * 实现上用**单遍 alternation**而不是状态机：字符串在前、注释在后，
 * 于是「先匹配到字符串」就天然保证了不会把 `t("a//b")` 里的 `//` 当注释。
 * 模板字面量整体按字符串处理（我们本来就不扫它内部）。
 */
export function stripComments(content: string): string {
  const TOKEN_RE =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g;
  return content.replace(TOKEN_RE, (match, str) => (str ? match : match.replace(/[^\n]/g, " ")));
}

const NAMESPACE_RE =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*["']([^"']+)["']\s*\)/g;

const RULE_MESSAGES: Record<TranslationUsageCode, string> = {
  MISSING_KEY: "缺少翻译 key",
  AMBIGUOUS_NAMESPACE_ALIAS:
    "同一个别名绑定了多个命名空间，静态阶段判不出这些调用属于哪个——请改成不同别名，而不是让其中一个被静默覆盖",
};

/** 转义后再拼进正则：`$` 在别名里是合法标识符字符，不转义会让它名下所有调用被跳过。 */
export function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 计算字符下标所在行（1 起算）。 */
export function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (content[i] === "\n") line += 1;
  return line;
}

/** 按点分 key 在命名空间树里查一层层嵌套；缺失返回 false。 */
export function hasPath(tree: unknown, key: string): boolean {
  let value: unknown = tree;
  for (const part of key.split(".")) {
    if (value === null || typeof value !== "object" || !(part in value)) return false;
    value = (value as Record<string, unknown>)[part];
  }
  return value !== undefined;
}

/**
 * 抽出文件里的命名空间绑定，以及**哪些别名出现了冲突**。
 *
 * 保留全部出现（不覆盖），由调用方决定怎么处理冲突——覆盖掉就是洞一。
 */
export function collectNamespaceBindings(rawContent: string): {
  bindings: NamespaceBinding[];
  ambiguous: Array<{ alias: string; namespaces: string[] }>;
} {
  const content = stripComments(rawContent);
  const byAlias = new Map<string, string[]>();
  for (const match of content.matchAll(NAMESPACE_RE)) {
    const [, alias, namespace] = match;
    const seen = byAlias.get(alias) ?? [];
    seen.push(namespace);
    byAlias.set(alias, seen);
  }
  const bindings: NamespaceBinding[] = [];
  const ambiguous: Array<{ alias: string; namespaces: string[] }> = [];
  for (const [alias, namespaces] of byAlias) {
    const distinct = [...new Set(namespaces)];
    if (distinct.length > 1) {
      ambiguous.push({ alias, namespaces: distinct });
      continue; // 冲突的别名不产出绑定：宁可不判，也不猜
    }
    bindings.push({ alias, namespace: distinct[0] });
  }
  return { bindings, ambiguous };
}

/** 构造匹配某个别名的调用正则（只认字面量 key：模板字符串与变量刻意跳过）。 */
export function callPatternFor(alias: string): RegExp {
  return new RegExp(
    `\\b${escapeForRegExp(alias)}\\s*(?:\\.\\s*(?:rich|raw|has))?\\s*\\(\\s*(["'])([^"']+)\\1`,
    "g",
  );
}

/** 一个别名在某个 locale 下缺 key 时的问题项；存在则返回空数组。 */
function missingKeyIssuesFor(
  input: TranslationUsageInput,
  filePath: string,
  content: string,
  bindings: readonly NamespaceBinding[],
  scannedCalls: Set<string>,
): TranslationUsageIssue[] {
  const issues: TranslationUsageIssue[] = [];
  for (const { alias, namespace } of bindings) {
    for (const match of content.matchAll(callPatternFor(alias))) {
      const key = `${namespace}.${match[2]}`;
      const line = lineOf(content, match.index ?? 0);
      scannedCalls.add(`${filePath}:${line}:${key}`);
      for (const locale of input.locales) {
        if (hasPath(input.messages[locale], key)) continue;
        issues.push({
          code: "MISSING_KEY",
          file: filePath,
          line,
          message: `${RULE_MESSAGES.MISSING_KEY} ${locale}: ${key}`,
        });
      }
    }
  }
  return issues;
}

/** 审计所有静态翻译调用在每个 locale 下是否都有 key。 */
export function auditTranslationUsage(input: TranslationUsageInput): TranslationUsageReport {
  const errors: TranslationUsageIssue[] = [];
  const scannedCalls = new Set<string>();
  let boundNamespaces = 0;

  for (const file of input.files) {
    // 先剥注释再扫：注释里的示例代码不是调用（这条门禁曾经因此报假红）。
    const content = stripComments(file.content);
    const { bindings, ambiguous } = collectNamespaceBindings(content);
    for (const { alias, namespaces } of ambiguous) {
      errors.push({
        code: "AMBIGUOUS_NAMESPACE_ALIAS",
        file: file.path,
        line: 1,
        message: `${RULE_MESSAGES.AMBIGUOUS_NAMESPACE_ALIAS}（别名 ${alias}：${namespaces.join(" / ")}）`,
      });
    }
    boundNamespaces += bindings.length;
    errors.push(...missingKeyIssuesFor(input, file.path, content, bindings, scannedCalls));
  }

  return {
    errors,
    stats: {
      scannedFiles: input.files.length,
      scannedCalls: scannedCalls.size,
      boundNamespaces,
    },
  };
}

/** 把问题列表格式化成多行文本（供 CLI 与单测断言）。 */
export function formatTranslationUsageIssues(issues: readonly TranslationUsageIssue[]): string {
  return issues
    .map((issue) => `❌ [${issue.code}] ${issue.file}:${issue.line} ${issue.message}`)
    .join("\n");
}
