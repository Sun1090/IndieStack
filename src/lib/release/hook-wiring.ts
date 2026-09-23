/**
 * Git 钩子层自检（C08 主题的延伸：把「写了文件」当成「会执行」）。
 *
 * 背景：`.husky/` 里躺着三个钩子，AGENTS.md 据此写着「pre-push 会自动跑 test + build」，
 * CONTRIBUTING.md 写着「commitlint 强制校验」。实测三件事同时不成立：
 * `core.hooksPath` 在任何 scope 都没有值、`husky` / `@commitlint/cli` / `lint-staged`
 * 都不在 `package.json`、`.husky/_/husky.sh` 不存在——新克隆一次都不会执行这些脚本。
 * 一个从不运行的守卫比没有守卫更糟：它让所有人在没保护的情况下相信自己有保护。
 *
 * 本模块只判断静态事实，全部输入可注入（CI 与单测都能跑）：
 *
 *   - 钩子必须能被 exec（shebang 开头），否则 git 静默跳过；
 *   - 钩子里 source 的路径必须存在（`$(dirname -- "$0")/x` 相对 `.husky/` 解析）；
 *   - 钩子里调用的命令必须可解析：`pnpm <script>` 要在 scripts 里、
 *     `pnpm exec|dlx <bin>` 与 `npx <bin>` 要在 `node_modules/.bin` 里、
 *     `node|bash|sh <path>` 指向的文件要存在；
 *   - 钩子目录非空时必须存在安装入口（`prepare` → `scripts/install-hooks.sh`），
 *     否则克隆下来仍然一个都不跑。
 *
 * 规则不判断钩子内容写得对不对——那是各条命令自己的事。
 */

const HOOK_DIR = ".husky";

/** pnpm 自己的子命令，不是 package.json 里的脚本。 */
const PNPM_BUILTINS = new Set([
  "add",
  "audit",
  "build",
  "config",
  "create",
  "dlx",
  "exec",
  "fetch",
  "import",
  "init",
  "install",
  "link",
  "list",
  "patch",
  "publish",
  "rebuild",
  "remove",
  "run",
  "store",
  "test",
  "uninstall",
  "unlink",
  "update",
]);

/** 随系统走的解释器与工具，不需要出现在 node_modules/.bin。 */
const SYSTEM_COMMANDS = new Set(["sh", "bash", "zsh", "node", "git", "echo", "printf", "cd", "set", "exit", "test"]);

export type HookIssueCode =
  | "missing-shebang"
  | "missing-sourced-file"
  | "unknown-pnpm-script"
  | "missing-binary"
  | "missing-file-operand"
  | "hooks-not-installed";

export interface HookDocument {
  /** 钩子文件名，如 `pre-push`。 */
  name: string;
  content: string;
}

export interface HookWiringInput {
  hooks: readonly HookDocument[];
  /** package.json 的 scripts 字段。 */
  scripts: Readonly<Record<string, string>>;
  /** `node_modules/.bin` 下真实存在的可执行名。 */
  bins: readonly string[];
  /** 判断仓库内某个相对路径（`/` 分隔）是否存在——由调用方提供，规则本身不碰文件系统。 */
  fileExists: (repoPath: string) => boolean;
}

export interface HookIssue {
  code: HookIssueCode;
  subject: string;
  message: string;
}

export interface HookWiringReport {
  issues: HookIssue[];
  /** 逐钩子解析出来的命令数，用于成功信息里说明覆盖面。 */
  checkedCommands: number;
  hookNames: string[];
}

function issue(code: HookIssueCode, subject: string, message: string): HookIssue {
  return { code, subject, message };
}

/** 去掉注释行与空行，钩子里的注释不该被当成命令解析。 */
function effectiveLines(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * 把 `$(dirname -- "$0")/relative` 解析成仓库路径（钩子住在 `.husky/`），
 * 其余 `$` 展开的形式返回 null——无法静态判定就不下结论。
 */
function resolveHookRelative(token: string): string | null {
  const match = /^\$\(dirname (?:-- )?"\$0"\)\/(.+)$/.exec(token);
  if (match) return `${HOOK_DIR}/${match[1]}`;
  if (token.startsWith("$") || token.startsWith("/")) return null;
  return token.replace(/^\.\//, "");
}

/**
 * 抽取 `pnpm` 调用：先跳过 `--flag`，再看首词是不是 `run|exec|dlx`。
 * 只覆盖「标志不带独立取值」的写法（`pnpm --silent x`、`pnpm x`）；
 * 出现 `--filter foo run x` 这类形态会把 `foo` 当成脚本名——宁可误报成
 * 「脚本不存在」让人去看一眼，也不要静默放过真的坏了的钩子。
 */
function pnpmCalls(line: string): { kind: "script" | "binary"; operand: string }[] {
  const found: { kind: "script" | "binary"; operand: string }[] = [];
  for (const match of line.matchAll(/\bpnpm\s+([^\n]+)/g)) {
    const tokens = match[1].split(/\s+/).filter(Boolean);
    let index = 0;
    while (index < tokens.length && tokens[index].startsWith("-")) index += 1;
    if (index >= tokens.length) continue;
    let isBinary = false;
    const head = tokens[index];
    if (head === "exec" || head === "dlx") {
      isBinary = true;
      index += 1;
    } else if (head === "run") {
      index += 1;
    }
    const operand = tokens[index];
    if (!operand) continue;
    if (isBinary) {
      found.push({ kind: "binary", operand });
      continue;
    }
    if (PNPM_BUILTINS.has(operand)) continue;
    found.push({ kind: "script", operand });
  }
  return found;
}

/** 抽取 `npx`（含 `npx --no --` / `npx --no-install`）调用的包名。 */
function npxCalls(line: string): string[] {
  return [...line.matchAll(/\bnpx\s+(?:--no\s+--\s+|--no-install\s+)?([\w./@-]+)/g)].map((m) => m[1]);
}

/** 抽取 `node|bash|sh <path>` 形态的文件操作数（只看像路径的参数）。 */
function fileOperands(line: string): string[] {
  const out: string[] = [];
  for (const match of line.matchAll(/\b(?:node|bash|sh)\s+([^\s]+)/g)) {
    const token = match[1];
    if (token.startsWith("-") || token.startsWith("$")) continue;
    if (/\.(?:js|mjs|cjs|ts|sh)$/.test(token)) out.push(token);
  }
  return out;
}

/**
 * 抽取 `. "path"` / `source "path"` 的 source 目标。
 * husky 那行里嵌着双引号（`"$(dirname -- "$0")/_/husky.sh"`），所以取整行再截文件名尾巴。
 */
function sourcedPaths(content: string): string[] {
  const out: string[] = [];
  for (const line of effectiveLines(content)) {
    const statement = /^(?:\.|source)\s+(.*)$/.exec(line);
    if (!statement) continue;
    const token = /((?:\$\([^)]*\)\/)?[\w./-]+\.(?:sh|js|mjs|ts))/.exec(statement[1]);
    if (token) out.push(token[1]);
  }
  return out;
}

interface ResolvedCommand {
  hook: string;
  kind: "script" | "binary" | "file";
  operand: string;
}

function collectCommands(name: string, content: string): ResolvedCommand[] {
  const out: ResolvedCommand[] = [];
  for (const line of effectiveLines(content)) {
    for (const call of pnpmCalls(line)) out.push({ hook: name, kind: call.kind, operand: call.operand });
    for (const bin of npxCalls(line)) out.push({ hook: name, kind: "binary", operand: bin });
    for (const file of fileOperands(line)) out.push({ hook: name, kind: "file", operand: file });
  }
  return out;
}

/** 校验单个钩子自身的可执行性与 source 目标，返回它带来的问题。 */
function auditHookFile(hook: HookDocument, fileExists: (repoPath: string) => boolean): HookIssue[] {
  const subject = `.husky/${hook.name}`;
  const issues: HookIssue[] = [];
  if (!hook.content.startsWith("#!")) {
    issues.push(issue("missing-shebang", subject, "钩子不以 `#!` 开头，git 无法直接 exec 它"));
  }
  for (const token of sourcedPaths(hook.content)) {
    const resolved = resolveHookRelative(token);
    if (resolved === null) continue;
    if (!fileExists(resolved)) {
      issues.push(
        issue("missing-sourced-file", subject, `钩子 source 的路径不存在：${resolved}（这一行会让钩子在第一步就失败）`),
      );
    }
  }
  return issues;
}

function auditCommand(cmd: ResolvedCommand, input: HookWiringInput, bins: ReadonlySet<string>): HookIssue | null {
  const subject = `.husky/${cmd.hook}`;
  if (cmd.kind === "script") {
    if (input.scripts[cmd.operand] === undefined && !SYSTEM_COMMANDS.has(cmd.operand)) {
      return issue(
        "unknown-pnpm-script",
        subject,
        `调用了 \`pnpm ${cmd.operand}\`，但 package.json 里没有这个脚本`,
      );
    }
    return null;
  }
  if (cmd.kind === "binary") {
    if (!bins.has(cmd.operand) && !SYSTEM_COMMANDS.has(cmd.operand)) {
      return issue(
        "missing-binary",
        subject,
        `调用了 \`${cmd.operand}\`，但它既不在 node_modules/.bin 也不是系统命令（未声明依赖）`,
      );
    }
    return null;
  }
  const resolved = resolveHookRelative(cmd.operand);
  if (resolved === null) return null;
  if (!input.fileExists(resolved)) {
    return issue("missing-file-operand", subject, `调用的文件不存在：${resolved}`);
  }
  return null;
}

/**
 * 安装入口是否接线：`prepare` 脚本存在且真的指向安装脚本，安装脚本文件也存在。
 * 没有安装入口时，钩子目录就是一堆永远不会被执行的文件。
 */
function auditInstallation(input: HookWiringInput): HookIssue[] {
  const prepare = input.scripts.prepare ?? "";
  const installer = findInstaller(prepare);
  if (installer === null) {
    return [
      issue(
        "hooks-not-installed",
        "Git 钩子安装入口",
        "package.json 的 `prepare` 没有指向钩子安装脚本（当前值：" +
          (prepare === "" ? "没有 prepare" : `\`${prepare}\``) +
          "）：新克隆 `pnpm install` 之后 git 不会执行 .husky/ 里的任何钩子",
      ),
    ];
  }
  if (!input.fileExists(installer)) {
    return [
      issue(
        "hooks-not-installed",
        "Git 钩子安装入口",
        `\`prepare\` 指向 ${installer}，但该文件不存在：钩子层等于没有安装入口`,
      ),
    ];
  }
  return [];
}

/** 从 `prepare` 命令里找钩子安装脚本：文件名必须含 `hook`，否则不算安装入口。 */
function findInstaller(prepare: string): string | null {
  for (const match of prepare.matchAll(/scripts\/[\w./-]+\.sh/g)) {
    if (/hook/i.test(match[0])) return match[0];
  }
  return null;
}

/** 执行钩子层自检。 */
export function auditHookWiring(input: HookWiringInput): HookWiringReport {
  const hooks = [...input.hooks].sort((left, right) => left.name.localeCompare(right.name));
  const bins = new Set(input.bins);
  const issues: HookIssue[] = [];
  let checkedCommands = 0;

  for (const hook of hooks) {
    issues.push(...auditHookFile(hook, input.fileExists));
    const commands = collectCommands(hook.name, hook.content);
    checkedCommands += commands.length;
    for (const cmd of commands) {
      const found = auditCommand(cmd, input, bins);
      if (found) issues.push(found);
    }
  }
  if (hooks.length > 0) issues.push(...auditInstallation(input));

  return { issues, checkedCommands, hookNames: hooks.map((hook) => hook.name) };
}

/** 把问题列表排成稳定的可读输出（供 CLI 与测试共用）。 */
export function formatHookIssues(issues: readonly HookIssue[]): string {
  return issues
    .slice()
    .sort((left, right) => `${left.code}${left.subject}`.localeCompare(`${right.code}${right.subject}`))
    .map((item) => `  [${item.code}] ${item.subject}\n    ${item.message}`)
    .join("\n");
}
