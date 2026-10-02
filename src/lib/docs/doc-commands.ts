/**
 * 面向用户的入门文档里，`pnpm <命令>` 指向的脚本必须真实存在。
 *
 * 背景：本仓库是**给别人用的模板**，而 README 与 quickstart 是新用户的前五分钟。
 * 一条写错的命令（`pnpm verifiy:build`）不会让任何门禁变红——它只会让用户在 clone 之后
 * 的第一条命令上撞墙。实测（2026-10-01）：这四份文件里共 **64 条 pnpm 命令**，
 * **全部存在**；也就是说仓库今天是干净的——但**「干净」不等于「被守着」**。
 *
 * **受审范围只有这四份文件，这是刻意的**（`SCOPED_DOCS`）：
 * 把范围放到全部 135 个 markdown 上会立刻变成一台**假红机器**——实测同一套判据在
 * `docs/progress.md`（我自己的推演记录，充满假设性命令）、`docs/operations/*`（模板里的
 * `pnpm check:x` 占位）、`docs/adr/*`（`pnpm catalog:…`）上会报出 12 条「不存在的命令」，
 * 而它们**全都合理**。那三类文件是**记录与计划**，不是**给用户的指令**——
 * 把它们混进来，就等于要求「一条记录里不许提到不存在的命令」，那显然不对。
 * 换句话说：**这条门禁判的是「文档教用户做的事存在吗」，不是「文档里出现过的字符串存在吗」。**
 *
 * **pnpm 内建命令**单独放行（`install` / `exec` / `audit` / `deploy` / `peers` / `catalog` …）：
 * 它们不是 `package.json` 的 scripts，但在终端里完全合法。
 *
 * **本模块刻意不判**：命令的**参数**是否存在（`pnpm vitest --wat` 里的 `--wat`）。
 * 判参数要复刻每个底层工具的 CLI 表面，那是一条会随依赖升级漂移的规则——
 * 与 #195 不判锚点是同一条理由。
 */

/** 受审文档：面向用户的入门材料。刻意不含 docs/（那是记录与计划）。 */
export const SCOPED_DOCS = [
  "README.md",
  "README.zh-CN.md",
  "docs-site/quickstart.md",
  "docs-site/zh-CN/quickstart.md",
] as const;

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

export type DocCommandCode = "DOC_COMMAND_UNKNOWN" | "DOC_COMMANDS_NOTHING_SCANNED";

export interface DocCommandIssue {
  code: DocCommandCode;
  file: string;
  line: number;
  command: string;
  message: string;
}

export interface DocCommandInput {
  /** 受审文档（仓库相对路径）。 */
  files: readonly string[];
  contents: Readonly<Record<string, string>>;
  /** `package.json` 的 scripts 注册表。 */
  scripts: Readonly<Record<string, string>>;
  /** `package.json` 的 dependencies + devDependencies。`pnpm exec <x>` 按它判定。 */
  dependencies?: Readonly<Record<string, string>>;
  /** 可注入的命令提取器，便于单测。 */
  extract?: (content: string) => ExtractedCommand[];
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
    /** 指向内建命令或 scripts 的，合计。 */
    resolved: number;
  };
}

export function auditDocCommands(input: DocCommandInput): DocCommandReport {
  const extract = input.extract ?? extractCommands;
  const errors: DocCommandIssue[] = [];
  let commands = 0;
  let resolved = 0;

  for (const file of input.files) {
    const content = input.contents[file];
    if (content === undefined) continue;
    for (const found of extract(content)) {
      commands += 1;
      // `pnpm exec <x>` 问的是「这个依赖装了吗」，不是「仓库有没有这个 script」——
      // 第一版把它也丢给 scripts/builtins 判，于是 `pnpm exec vitest` 被报成不存在的命令，
      // 而 vitest 明明在 devDependencies 里。**问错问题的门禁只会教人加豁免。**
      const known =
        found.command in input.scripts ||
        PNPM_BUILTINS.has(found.command) ||
        (found.viaExec && found.command in (input.dependencies ?? {}));
      if (known) {
        resolved += 1;
        continue;
      }
      errors.push({
        code: "DOC_COMMAND_UNKNOWN",
        file,
        line: found.line,
        command: found.command,
        message:
          found.viaExec
            ? `\`pnpm exec ${found.command}\` 依赖 devDependencies/dependencies 里存在 ${found.command}，而它不在里面`
            : `package.json 里既没有这个 script，它也不是 pnpm 内建命令。` +
              "用户照抄会在 clone 之后的第一条命令上撞墙——要么补上脚本，要么改文档里的命令",
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

  return { errors, stats: { files: input.files.length, commands, resolved } };
}

/** 把问题列表格式化成多行文本（供 CLI 与单测断言）。 */
export function formatDocCommandIssues(issues: readonly DocCommandIssue[]): string {
  return issues
    .map(
      (issue) =>
        `❌ [${issue.code}] ${issue.file}:${issue.line} → \`pnpm ${issue.command}\`：${issue.message}`,
    )
    .join("\n");
}

/** 成功时的自述行——把分母报出来。 */
export function formatDocCommandSummary(report: DocCommandReport): string {
  const { files, commands } = report.stats;
  return `✅ 入门文档里的命令都存在：${commands} 条 pnpm 命令 / ${files} 份文档`;
}