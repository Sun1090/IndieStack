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
  | "hooks-not-installed"
  | "installer-unterminated-variable";

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
  /**
   * 钩子安装脚本的正文（`prepare` 指向的那个 `.sh`）。
   * `null` / `undefined` 表示没读到——此时**不下结论**（这条判定是加强项，
   * 不能因为 IO 侧没接线就把整个钩子层判红）。
   */
  installerContent?: string | null;
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

/**
 * `$VAR` 后面紧跟一个非 ASCII 字符（`echo "... 个（$hooks_dir）"` 这种写法）。
 *
 * 为什么这算 bug：POSIX 变量名只含 ASCII，但 **bash 按字节判断名字边界**，
 * 于是全角括号的第一个字节被吞进变量名——`$hooks_dir）` 查的其实是
 * `hooks_dir<E3>` 这个不存在的变量。在 `set -u` 下脚本当场中止：
 *
 *   scripts/install-hooks.sh: line 52: hooks_dir<U+FFFD>: unbound variable
 *
 * 实测分两种（同一份脚本、同一个 `set -u`）：
 *   - macOS `/bin/sh` 是 bash ⇒ **退出码 1**；
 *   - ubuntu 上 `/bin/sh` 是 dash（zsh 同）⇒ 正常打印，退出码 0。
 * 所以这条缺陷**在 CI 里是绿的、在用户的笔记本上是红的**。
 *
 * 落地后果比报错信息严重：`prepare` 非零退出会让 `pnpm install` 整体失败
 * （`[ELIFECYCLE] Command failed with exit code 1`），而它挂掉的那一行是
 * 函数最后的成功提示——**软链已经建好了，钩子其实是装上的**，
 * 于是新用户看到「安装失败」但守卫其实在，这比单纯的失败更难排查。
 * 触发条件也恰好是「新克隆第一次装钩子」（`installed > 0`），
 * 老克隆因为幂等早退所以永远看不到。
 *
 * 判据刻意保守，只抓这一种形状：
 *   - 跳过整行注释；
 *   - 跳过单引号区间（单引号内 shell 不做展开，`'$x）'` 是无辜的）；
 *   - 变量名必须是 POSIX 形态（`[A-Za-z_][A-Za-z0-9_]*`），`$1）`、`$@）` 这类不算。
 * `${hooks_dir}）` 是正确修法，不报（花括号已经界定边界）。
 */
const UNTERMINATED_VARIABLE = /\$([A-Za-z_][A-Za-z0-9_]*)([^\x00-\x7F])/;

/** 去掉单引号包裹的区间（shell 在其中不展开变量），保留换行以维持行号。 */
function withoutSingleQuotes(line: string): string {
  return line.replace(/'(?:[^']|\\')*'/g, (region) => region.replace(/[^\n]/g, " "));
}

/** 扫描安装脚本，返回「`$VAR` 紧跟非 ASCII」所在的行号（1 起）与片段。 */
export function findUnterminatedVariables(
  content: string,
): Array<{ line: number; snippet: string }> {
  const found: Array<{ line: number; snippet: string }> = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (/^\s*#/.test(raw)) continue;
    const scannable = withoutSingleQuotes(raw);
    const match = UNTERMINATED_VARIABLE.exec(scannable);
    if (!match) continue;
    found.push({ line: index + 1, snippet: raw.trim() });
  }
  return found;
}

/**
 * 安装脚本自身的健康度。
 *
 * 已有的 `hooks-not-installed` 只回答「装钩子的脚本在不在」，
 * 不回答「它跑不跑得完」——本次缺陷正好从这两者之间的缝里漏过去：
 * 文件存在、`prepare` 接线正确、`check:hooks` 全绿，而真实克隆里 `pnpm install` 失败。
 */
function auditInstallerScript(input: HookWiringInput): HookIssue[] {
  const content = input.installerContent;
  if (content === null || content === undefined) return [];
  const issues: HookIssue[] = [];
  for (const hit of findUnterminatedVariables(content)) {
    issues.push(
      issue(
        "installer-unterminated-variable",
        "Git 钩子安装脚本",
        `第 ${hit.line} 行 \`$变量\` 后紧跟全角字符（${hit.snippet}）：bash 按字节判断变量名边界，` +
          "会把多字节字符的首字节吞进变量名，于是 `set -u` 下当场 unbound variable、" +
          "`prepare` 非零退出、`pnpm install` 整体失败。改成 `${VAR}` 即可。" +
          "（macOS /bin/sh 是 bash 会红，ubuntu 的 dash 与 zsh 不红——所以 CI 抓不到它。）",
      ),
    );
  }
  return issues;
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
  if (hooks.length > 0) issues.push(...auditInstallerScript(input));

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
