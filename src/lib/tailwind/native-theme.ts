/**
 * Tailwind v4 原生主题门禁（G01「试点页迁移」）。
 *
 * ADR-013 已经把 `@config` 桥接换成 v4 原生 `@theme` / `@utility` / `@custom-variant`，
 * 但机制换掉不等于用法换掉：之后的页面仍然可能写回 v3 时代的类名、或者绕过 theme
 * token 直接内联 `animate-[...]`，让「单一事实源」重新长回两套。这个模块把那些回退
 * 变成构建前的失败，而不是等视觉回归时才发现。
 *
 * 规则分两层：
 *  1. 仓库结构层（全局生效）：没有 `tailwind.config.*`、没有 `@config`、没有
 *     `tailwindcss-animate` 插件依赖、`@theme` 必须存在、每个 `@keyframes` 都要有
 *     `--animate-*` token 认领。
 *  2. 应用层写法（`src/**` 去掉 `src/components/ui/**`）：禁用 v4 已更名/改语义的
 *     工具类，禁用任意值动画 `animate-[...]`。
 *
 * `src/components/ui/**` 是 shadcn 上游基元的落点，写法跟随上游版本更新，所以只统计
 * 成一条非阻断 warning（收口进度可见、但不会为了改类名手改上游文件）。`shadow` /
 * `rounded` / `blur` 这类「裸名」不在禁用列表：本项目 `@theme inline` 里把 radius
 * 刻度显式映射回 shadcn 语义（`--radius-sm: calc(var(--radius) - 4px)`），实测
 * `.rounded` 与 `.rounded-sm` 都解析为 4px，改名只会制造无收益的 diff。
 */

export type TailwindFile = {
  /** 仓库相对路径，用于问题定位 */
  path: string;
  content: string;
};

export type TailwindNativeSnapshot = {
  /** 仓库根存在的 `tailwind.config.*` 文件名（存在即 JS 配置回归） */
  configFiles: string[];
  /** 纳入扫描的 CSS（`src/**` 下的全部样式文件） */
  cssFiles: TailwindFile[];
  /** 应用层源码（已排除 `src/components/ui/**` 与测试文件） */
  sourceFiles: TailwindFile[];
  /** 上游 shadcn 基元目录源码，只做非阻断统计 */
  excludedFiles: TailwindFile[];
  /** `dependencies` + `devDependencies` 的包名集合 */
  dependencies: string[];
};

export type TailwindNativeIssueCode =
  | "TW_CONFIG_FILE_PRESENT"
  | "TW_CONFIG_DIRECTIVE"
  | "TW_ANIMATE_PLUGIN_DEP"
  | "TW_THEME_MISSING"
  | "TW_KEYFRAME_UNTOKENED"
  | "TW_ARBITRARY_ANIMATE"
  | "TW_RENAMED_UTILITY";

export type TailwindNativeIssue = {
  code: TailwindNativeIssueCode;
  path: string;
  /** 1 起始行号 */
  line: number;
  message: string;
};

export type TailwindNativeReport = {
  errors: TailwindNativeIssue[];
  warnings: TailwindNativeIssue[];
};

/** 应用层禁用清单：v4 已更名或语义已改变的 v3 工具类。 */
export const RENAMED_UTILITIES: readonly {
  /** 用于错误信息的可读名称 */
  name: string;
  pattern: RegExp;
  replacement: string;
  note: string;
}[] = [
  {
    name: "bg-gradient-to-*",
    pattern: /(?<![\w-])bg-gradient-to-(?:t|tr|r|br|b|bl|l|tl)(?![\w-])/g,
    replacement: "bg-linear-to-*",
    note: "v4 更名为 bg-linear-to-*（旧名只剩兼容别名）",
  },
  {
    name: "outline-none",
    pattern: /(?<![\w-])outline-none(?![\w-])/g,
    replacement: "outline-hidden",
    note: "v4 的 outline-none 会彻底移除轮廓（含 forced-colors 模式），改用 outline-hidden",
  },
  {
    name: "flex-shrink-0",
    pattern: /(?<![\w-])flex-shrink-0(?![\w-])/g,
    replacement: "shrink-0",
    note: "v4 统一为 shrink-*",
  },
  {
    name: "flex-shrink",
    pattern: /(?<![\w-])flex-shrink(?![\w-])/g,
    replacement: "shrink",
    note: "v4 统一为 shrink-*",
  },
  {
    name: "flex-grow-0",
    pattern: /(?<![\w-])flex-grow-0(?![\w-])/g,
    replacement: "grow-0",
    note: "v4 统一为 grow-*",
  },
  {
    name: "flex-grow",
    pattern: /(?<![\w-])flex-grow(?![\w-])/g,
    replacement: "grow",
    note: "v4 统一为 grow-*",
  },
  {
    name: "overflow-ellipsis",
    pattern: /(?<![\w-])overflow-ellipsis(?![\w-])/g,
    replacement: "text-ellipsis",
    note: "v4 更名为 text-ellipsis",
  },
  {
    name: "decoration-slice",
    pattern: /(?<![\w-])decoration-slice(?![\w-])/g,
    replacement: "box-decoration-slice",
    note: "v4 更名为 box-decoration-slice",
  },
  {
    name: "decoration-clone",
    pattern: /(?<![\w-])decoration-clone(?![\w-])/g,
    replacement: "box-decoration-clone",
    note: "v4 更名为 box-decoration-clone",
  },
];

/** 任意值动画：必须先在 `@theme` 里登记 `--animate-*` token。 */
export const ARBITRARY_ANIMATE_PATTERN = /(?<![\w-])animate-\[/g;

const ANIMATION_TOKEN_PATTERN = /--animate-[\w-]*\s*:\s*([^;]+);/g;
const KEYFRAMES_PATTERN = /@keyframes\s+([A-Za-z_][\w-]*)/g;
const CONFIG_DIRECTIVE_PATTERN = /@config\b/g;
const THEME_BLOCK_PATTERN = /@theme\b/;

/** 把 CSS 块注释替换成等长空白（保留换行），避免注释里提到 @config 或关键帧名字时误报。 */
export function stripCssComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectMatches(content: string, pattern: RegExp): { value: string; index: number }[] {
  const matches: { value: string; index: number }[] = [];
  const re = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    matches.push({ value: match[1] ?? match[0], index: match.index });
  }
  return matches;
}

/** `@keyframes` 的名字必须被至少一个 `--animate-*` token 引用，否则就是绕过 theme 的裸动画。 */
export function findUntokenedKeyframes(content: string): { name: string; index: number }[] {
  const tokenValues = collectMatches(content, ANIMATION_TOKEN_PATTERN)
    .map((m) => m.value)
    .join("\n");
  return collectMatches(content, KEYFRAMES_PATTERN)
    .filter(({ value }) => {
      const re = new RegExp(`(?<![\\w-])${escapeRegExp(value)}(?![\\w-])`);
      return !re.test(tokenValues);
    })
    .map(({ value, index }) => ({ name: value, index }));
}

/** 返回应用层文件中命中的 v3 类名（用于门禁与测试）。 */
export function findRenamedUtilities(content: string): { name: string; replacement: string; index: number }[] {
  const hits: { name: string; replacement: string; index: number }[] = [];
  for (const rule of RENAMED_UTILITIES) {
    for (const match of collectMatches(content, rule.pattern)) {
      hits.push({ name: match.value, replacement: rule.replacement, index: match.index });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

export function auditTailwindNative(snapshot: TailwindNativeSnapshot): TailwindNativeReport {
  const errors: TailwindNativeIssue[] = [];
  const warnings: TailwindNativeIssue[] = [];

  for (const file of snapshot.configFiles) {
    errors.push({
      code: "TW_CONFIG_FILE_PRESENT",
      path: file,
      line: 1,
      message: `检测到 ${file}：JS 配置已在 ADR-013 移除，主题必须写在 src/app/globals.css 的 @theme 里`,
    });
  }

  if (snapshot.dependencies.includes("tailwindcss-animate")) {
    errors.push({
      code: "TW_ANIMATE_PLUGIN_DEP",
      path: "package.json",
      line: 1,
      message: "不再依赖 tailwindcss-animate（v3 插件），动画走 tw-animate-css + @theme token",
    });
  }

  const themeFiles = snapshot.cssFiles.filter((file) => THEME_BLOCK_PATTERN.test(file.content));
  if (themeFiles.length === 0) {
    errors.push({
      code: "TW_THEME_MISSING",
      path: snapshot.cssFiles[0]?.path ?? "src/app/globals.css",
      line: 1,
      message: "找不到 @theme 块：v4 原生主题映射缺失，工具类会退化成无 token 的裸值",
    });
  }

  for (const file of snapshot.cssFiles) {
    const scannable = stripCssComments(file.content);
    for (const match of collectMatches(scannable, CONFIG_DIRECTIVE_PATTERN)) {
      errors.push({
        code: "TW_CONFIG_DIRECTIVE",
        path: file.path,
        line: lineOf(scannable, match.index),
        message: "@config 桥接已移除（ADR-013），改在 @theme / @utility / @custom-variant 里声明",
      });
    }
    for (const { name, index } of findUntokenedKeyframes(scannable)) {
      errors.push({
        code: "TW_KEYFRAME_UNTOKENED",
        path: file.path,
        line: lineOf(scannable, index),
        message: `@keyframes ${name} 没有被任何 --animate-* token 引用：请在 @theme 里登记 token，由 animate-${name} 消费`,
      });
    }
  }

  for (const file of snapshot.sourceFiles) {
    for (const match of collectMatches(file.content, ARBITRARY_ANIMATE_PATTERN)) {
      errors.push({
        code: "TW_ARBITRARY_ANIMATE",
        path: file.path,
        line: lineOf(file.content, match.index),
        message: "animate-[...] 任意值绕过主题 token：请在 @theme 登记 --animate-* 后用动画工具类",
      });
    }
    for (const hit of findRenamedUtilities(file.content)) {
      const note = RENAMED_UTILITIES.find((rule) => rule.replacement === hit.replacement)?.note;
      errors.push({
        code: "TW_RENAMED_UTILITY",
        path: file.path,
        line: lineOf(file.content, hit.index),
        message: `${hit.name} 是 v3 写法：改用 ${hit.replacement}${note ? `（${note}）` : ""}`,
      });
    }
  }

  const excludedHits = snapshot.excludedFiles.reduce(
    (total, file) => total + findRenamedUtilities(file.content).length,
    0,
  );
  if (excludedHits > 0) {
    warnings.push({
      code: "TW_RENAMED_UTILITY",
      path: "src/components/ui",
      line: 1,
      message: `上游 shadcn 基元里还有 ${excludedHits} 处 v3 类名待跟随上游收口（非阻断）`,
    });
  }

  return { errors, warnings };
}

export function formatTailwindNativeIssues(
  level: "error" | "warning",
  issues: TailwindNativeIssue[],
): string {
  const icon = level === "error" ? "❌" : "⚠️";
  return issues
    .map((issue) => `${icon} [${issue.code}] ${issue.path}:${issue.line} ${issue.message}`)
    .join("\n");
}
