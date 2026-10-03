/**
 * 文档里 `pnpm <命令>` 指向的东西必须真的存在。
 *
 * 背景：本仓库是**给别人用的模板**，而文档是它的产品。一条写错的命令
 * （`pnpm verifiy:build`）不会让任何门禁变红——它只会让模板用户在 clone 之后撞墙。
 *
 * **受审范围**（`SCOPED_DOC_PATTERNS` / `EXCLUDED_DOC_PATTERNS`）是仓库里全部 markdown，
 * 减去三类**记录与计划**：`docs/progress.md`（推演记录，充满假设性命令）、`docs/roadmap-*.md`
 * （计划）、以及已完成版本的报告/模板（里面的 `pnpm check:x` 是**占位写法**，不是命令）。
 * 这条界线不是「哪些文件重要」，而是**「记录里可以提到不存在的东西，给用户的指令不行」**——
 * 把推演记录也纳入，就等于要求「一条记录里不许提到假命令」，那显然不对。
 *
 * **判定要问对人**（2026-10-03 修）：pnpm 对未知命令的语义是**当 shell 命令执行，
 * 并把 `node_modules/.bin` 放进 PATH**。所以「这条命令能不能跑」的答案是
 * **「那个二进制在不在 `.bin` 里」**，而不是「`package.json` 里有没有同名 script」。
 * 前一版按 script 判，于是 `pnpm vitest run …` / `pnpm exec playwright test` 这类
 * **完全能跑**的命令被报成「不存在」——实测在 `docs/db` / `docs/operations` / `docs/testing.md`
 * 上一次报出 6 条，全是假红。**一条只会喊假红的门禁只会教人加豁免。**
 * 现在放行的四条依据，任何一条都不降低严格性：
 *   - `package.json` 的 scripts；
 *   - pnpm 内建命令；
 *   - **`node_modules/.bin` 里真的有那个文件**（地面真相）；
 *   - 依赖名恰好等于命令名（`.bin` 读不到时的退化路径，npm 约定 bin 默认同名）。
 *
 * **外部 CLI 登记表**：像 Supabase CLI 这种**必须由用户自行安装、不在本仓库依赖里**的工具，
 * 门禁无法核对它的存在，所以显式登记并写明理由（`EXTERNAL_CLIS`）。
 * 登记而不是放过：放过等于「文档里出现过的任何字符串都算合法」，那和没有这条门禁一样。
 *
 * **本模块刻意不判**：命令的**参数**是否存在（`pnpm vitest --wat` 里的 `--wat`）。
 * 判参数要复刻每个底层工具的 CLI 表面，那是一条会随依赖升级漂移的规则——
 * 与 #195 不判锚点是同一条理由。
 */

/** 受审范围：仓库里全部 markdown（根级 + docs-site/ + docs/）。 */
export const SCOPED_DOC_PATTERNS: readonly string[] = [
  "*.md",
  "docs-site/**/*.md",
  "docs/**/*.md",
];

/**
 * 排除项与理由。**理由不许为空**：空理由的排除等于「我不想看这个文件」，
 * 而那正是本门禁要消灭的形状之一，所以它自己要先被规则检查一遍。
 *
 * 每条排除还必须真的命中至少一个文件（`DOC_EXCLUSION_STALE`）：文件改名之后排除项就失效，
 * 而失效的排除项仍留在配置里，下一个人会以为那里仍然没被审。
 */
export const EXCLUDED_DOC_PATTERNS: Readonly<Record<string, string>> = {
  "CHANGELOG.md":
    "变更记录：它会**故意引用不存在的命令**来说明门禁在抓什么（`pnpm verifiy:build` 就是这一类例子）",
  "docs/progress.md": "进度台账：它是推演记录，允许引用还没写的命令与假想门禁",
  "docs/roadmap-*.md": "roadmap 是计划：条目里的命令常常是「打算加的」",
  "docs/operations/release-audit-template.md":
    "审计模板：`pnpm check:x` 是占位写法，模板要的就是这个形状",
  "docs/operations/release-exit-report-*.md":
    "已封存的退出报告：`pnpm check:*` 是在描述一类门禁，不是一条命令",
};

/**
 * 需要用户自行安装的外部 CLI：不在本仓库依赖里，门禁无法核对它是否存在。
 * 登记而不是放过——放过等于放弃这道断言。
 */
export const EXTERNAL_CLIS: Readonly<Record<string, string>> = {
  supabase: "Supabase CLI（模板用户按 docs-site/deployment.md 自行安装；不属于本仓库依赖）",
};

// 把 glob 片段编译成正则：双星加斜杠可跨层、双星任意、单星不跨斜杠。
// （注释里不能出现 `星星/斜杠` 的写法——那会提前结束块注释。）
function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:[^/]+/)*";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
      continue;
    }
    source += char === "*" ? "[^/]*" : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

const SCOPED_MATCHERS = SCOPED_DOC_PATTERNS.map(globToRegExp);

/**
 * 从仓库列出的 markdown 里挑出受审文档，并记下每一份被排除的文件与它的理由。
 *
 * 纯函数（只吃路径列表），所以「范围规则」本身也能被单测覆盖，
 * 不必在测试里造一棵真的 docs 树。
 */
export function selectScopedDocs(
  files: readonly string[],
  excluded: Readonly<Record<string, string>> = EXCLUDED_DOC_PATTERNS,
): {
  scoped: string[];
  exclusions: { file: string; pattern: string; reason: string }[];
  unusedExclusions: string[];
} {
  const scoped: string[] = [];
  const exclusions: { file: string; pattern: string; reason: string }[] = [];
  const used = new Set<string>();

  for (const file of [...files].sort()) {
    if (!SCOPED_MATCHERS.some((matcher) => matcher.test(file))) continue;
    const pattern = Object.keys(excluded).find((candidate) =>
      globToRegExp(candidate).test(file),
    );
    if (pattern === undefined) {
      scoped.push(file);
      continue;
    }
    used.add(pattern);
    exclusions.push({ file, pattern, reason: excluded[pattern] ?? "" });
  }

  const unusedExclusions = Object.keys(excluded)
    .filter((pattern) => !used.has(pattern))
    .sort();
  return { scoped, exclusions, unusedExclusions };
}

/** pnpm 内建命令：不是 scripts，但在终端里合法。 */
export const PNPM_BUILTINS: ReadonlySet<string> = new Set([
  "install",
  "i",
  "add",
  "remove",
  "rm",
  "uninstall",
  "exec",
  "dlx",
  "audit",
  "outdated",
  "list",
  "ls",
  "why",
  "run",
  "publish",
  "pack",
  "store",
  "config",
  "peers",
  "catalog",
  "deploy",
  "version",
  "import",
  "prune",
  "rebuild",
  "fetch",
  "create",
  "init",
]);

export type DocCommandCode =
  | "DOC_COMMAND_UNKNOWN"
  | "DOC_COMMANDS_NOTHING_SCANNED"
  | "DOC_EXCLUSION_REASON_MISSING"
  | "DOC_EXCLUSION_STALE";

export interface DocCommandIssue {
  code: DocCommandCode;
  file: string;
  line: number;
  command: string;
  /** 文档里写的是 `pnpm exec <x>` 时为 true——报错要照抄原文，不能把 exec 吃掉。 */
  viaExec?: boolean;
  message: string;
}

export interface DocCommandInput {
  /** 受审文档（仓库相对路径）——由 `selectScopedDocs` 选出。 */
  files: readonly string[];
  contents: Readonly<Record<string, string>>;
  /** `package.json` 的 scripts 注册表。 */
  scripts: Readonly<Record<string, string>>;
  /** `package.json` 的 dependencies + devDependencies。`.bin` 读不到时的退化路径。 */
  dependencies?: Readonly<Record<string, string>>;
  /**
   * `node_modules/.bin` 里的文件名——「这条命令能不能跑」的地面真相。
   * `null` 表示没读到（没跑过 `pnpm install`），此时只退回依赖名判定，不因此单独报红。
   */
  binaries?: ReadonlySet<string> | null;
  /** 外部 CLI 登记表，默认 `EXTERNAL_CLIS`。 */
  externalClis?: Readonly<Record<string, string>>;
  /** 可注入的命令提取器，便于单测。 */
  extract?: (content: string) => ExtractedCommand[];
  /** 排除项审计结果（由 `selectScopedDocs` 给出），默认不检查。 */
  exclusions?: { exclusions: { file: string; pattern: string; reason: string }[]; unusedExclusions: string[] };
}

export interface ExtractedCommand {
  command: string;
  line: number;
  /** 是否写成 `pnpm exec <x>`——那运行的是**依赖里的二进制**，不是仓库脚本。 */
  viaExec: boolean;
}

/** 抽出一份文档里出现的 `pnpm <cmd>` / `pnpm run <cmd>`。行号 1 起算。 */
export function extractCommands(content: string): ExtractedCommand[] {
  const out: ExtractedCommand[] = [];
  content.split("\n").forEach((line, i) => {
    // 跳过代码块围栏内的 shell 提示符，以及行内代码的反引号包裹——它们仍然是指令，
    // 所以这里只排除「不是命令」的三种写法：句中散文、URL、以及 `pnpm` 后紧跟标点。
    for (const match of line.matchAll(/\bpnpm\s+(?:(run|exec)\s+)?([a-z][a-z0-9:_-]*)/g)) {
      out.push({ command: match[2], line: i + 1, viaExec: match[1] === "exec" });
    }
  });
  return out;
}

export interface DocCommandReport {
  errors: DocCommandIssue[];
  stats: {
    files: number;
    commands: number;
    /** 有落点的命令数（script / 内建 / 二进制 / 依赖名 / 外部 CLI）。 */
    resolved: number;
    /** 因排除而未被审的文件数。 */
    excluded: number;
    /** `.bin` 是否真的读到了；false 时读数要打折说。 */
    binariesRead: boolean;
  };
}

/** 排除项自身的审计：理由不许为空，且每条排除都必须真的命中文件。 */
function inspectExclusions(
  exclusions: DocCommandInput["exclusions"],
): DocCommandIssue[] {
  const issues: DocCommandIssue[] = [];
  for (const exclusion of exclusions?.exclusions ?? []) {
    if (exclusion.reason.trim() !== "") continue;
    issues.push({
      code: "DOC_EXCLUSION_REASON_MISSING",
      file: exclusion.file,
      line: 0,
      command: "",
      message:
        `排除项 ${exclusion.pattern} 没有写理由。空理由的排除等于「我不想看这个文件」，` +
        "而那正是这道断言要消灭的形状之一",
    });
  }
  for (const pattern of exclusions?.unusedExclusions ?? []) {
    issues.push({
      code: "DOC_EXCLUSION_STALE",
      file: pattern,
      line: 0,
      command: "",
      message:
        `排除项 ${pattern} 一个文件都没命中：它已经失效（文件改名或删除），` +
        "而失效的排除项仍留在配置里，下一个人会以为那里仍然没被审",
    });
  }
  return issues;
}

/** 一条命令有没有落点：四条依据（理由见文件头）。 */
function hasLanding(
  found: ExtractedCommand,
  input: DocCommandInput,
  binaries: ReadonlySet<string> | null,
  externalClis: Readonly<Record<string, string>>,
): boolean {
  return (
    found.command in input.scripts ||
    PNPM_BUILTINS.has(found.command) ||
    binaries?.has(found.command) === true ||
    found.command in (input.dependencies ?? {}) ||
    externalClis[found.command] !== undefined
  );
}

export function auditDocCommands(input: DocCommandInput): DocCommandReport {
  const extract = input.extract ?? extractCommands;
  const binaries = input.binaries ?? null;
  const externalClis = input.externalClis ?? EXTERNAL_CLIS;
  const errors: DocCommandIssue[] = inspectExclusions(input.exclusions);
  let commands = 0;
  let resolved = 0;

  for (const file of input.files) {
    const content = input.contents[file];
    if (content === undefined) continue;
    for (const found of extract(content)) {
      commands += 1;
      if (hasLanding(found, input, binaries, externalClis)) {
        resolved += 1;
        continue;
      }
      const notes: string[] = [
        "package.json 里没有这个 script，node_modules/.bin 里也没有这个二进制，外部 CLI 登记表里也没有它。",
      ];
      // 「没装依赖」与「一个二进制都没有」的处置完全不同（先 pnpm install vs 补依赖），
      // 所以退化路径必须自报，而不是安静地按更弱的证据报绿。
      if (binaries === null) {
        notes.push("（本次没读到 node_modules/.bin——若已执行 pnpm install，也可能是它确实不存在）");
      }
      notes.push("用户照抄会在 clone 之后的第一条命令上撞墙：要么补上脚本/依赖，要么改文档里的命令");
      errors.push({
        code: "DOC_COMMAND_UNKNOWN",
        file,
        line: found.line,
        command: found.command,
        viaExec: found.viaExec,
        message: notes.join(""),
      });
    }
  }

  if (input.files.length === 0) {
    errors.push({
      code: "DOC_COMMANDS_NOTHING_SCANNED",
      file: "(none)",
      line: 0,
      command: "",
      message: "一份受审文档都没读到：这道断言量不到任何东西",
    });
  }

  return {
    errors,
    stats: {
      files: input.files.length,
      commands,
      resolved,
      excluded: input.exclusions?.exclusions.length ?? 0,
      binariesRead: binaries !== null,
    },
  };
}

/** 把问题列表格式化成多行文本（供 CLI 与单测断言）。 */
export function formatDocCommandIssues(issues: readonly DocCommandIssue[]): string {
  return issues
    .map(
      (issue) =>
        `❌ [${issue.code}] ${issue.file}:${issue.line} → ` +
        `\`pnpm ${issue.viaExec ? "exec " : ""}${issue.command}\`：${issue.message}`,
    )
    .join("\n");
}

/**
 * 成功时的自述行——把分母报出来。
 *
 * `node_modules/.bin` 没读到时必须**说出来**：那份读数是在更弱的证据下得到的，
 * 而一个不说自己弱在哪的绿色数字正是本项目反复消灭的东西。
 */
export function formatDocCommandSummary(report: DocCommandReport): string {
  const { files, commands, excluded, binariesRead } = report.stats;
  const binNote = binariesRead ? "" : "（本次没读到 node_modules/.bin，判定已退回依赖名比对）";
  return (
    `✅ 文档里的 pnpm 命令都有落点：${commands} 条命令 / ${files} 份受审文档` +
    `（另排除 ${excluded} 份记录与计划）${binNote}`
  );
}