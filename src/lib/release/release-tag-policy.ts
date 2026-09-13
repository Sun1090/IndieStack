/**
 * Tag / GitHub Release 自动化契约（J07）。
 *
 * 背景：发布工作流只做 `git describe` + `gh release create --generate-notes` 时，标签可以和
 * `package.json` 版本不一致、CHANGELOG 可以没有对应版本、Release Notes 也可以绕过仓库内已审核的
 * 发布说明。更危险的是，标签一推就直接写 GitHub Release，没有任何发布门禁先跑。
 *
 * 本模块把发布入口固化为可执行规则：
 *
 *   - 标签必须是 `v<package.json version>`，版本必须是 `x.y.z`；
 *   - `CHANGELOG.md` 必须存在同版本、带合法日期且非空的已发布章节；
 *   - Release Notes 必须从该章节抽取，写成 `--notes-file`，不能再用 `--generate-notes` 绕过；
 *   - release.yml 必须在创建 Release 前安装依赖、运行 `pnpm check:all` 与
 *     `pnpm check:release-tag --tag ... --notes-output ...`，并保留 `contents: write`、全历史 checkout 与超时。
 *
 * 纯函数，不读文件系统；IO/CLI 在 `scripts/lib/release-tag-check.js` 与
 * `scripts/check-release-tag.js`。
 */

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ReleaseTagContract {
  /** 标签前缀。 */
  tagPrefix: string;
  /** CHANGELOG 路径。 */
  changelogPath: string;
  /** Release workflow 路径。 */
  workflowPath: string;
  /** 创建 Release 前必须执行的发布门禁。 */
  requiredGateCommands: readonly string[];
  /** Release Notes 必须是文件输入，禁止自动生成。 */
  requiredNotesFlag: string;
  /** 明确禁止的自动 notes 参数。 */
  forbiddenNotesFlag: string;
}

export const RELEASE_TAG_CONTRACT: ReleaseTagContract = {
  tagPrefix: "v",
  changelogPath: "CHANGELOG.md",
  workflowPath: ".github/workflows/release.yml",
  requiredGateCommands: ["pnpm check:all", "pnpm check:release-tag"],
  requiredNotesFlag: "--notes-file",
  forbiddenNotesFlag: "--generate-notes",
};

export interface ChangelogEntry {
  version: string;
  date: string;
  body: string;
}

export interface ReleaseNotes {
  version: string;
  tagName: string;
  date: string;
  title: string;
  body: string;
}

export type ReleaseTagIssueCode =
  | "RELEASE_PACKAGE_VERSION_INVALID"
  | "RELEASE_TAG_PREFIX_MISSING"
  | "RELEASE_TAG_VERSION_INVALID"
  | "RELEASE_TAG_VERSION_MISMATCH"
  | "RELEASE_CHANGELOG_ENTRY_MISSING"
  | "RELEASE_CHANGELOG_ENTRY_EMPTY"
  | "RELEASE_CHANGELOG_DATE_INVALID"
  | "RELEASE_WORKFLOW_MISSING"
  | "RELEASE_TRIGGER_DRIFT"
  | "RELEASE_PERMISSION_MISSING"
  | "RELEASE_FETCH_DEPTH_DRIFT"
  | "RELEASE_INSTALL_MISSING"
  | "RELEASE_GATE_MISSING"
  | "RELEASE_TAG_CHECK_MISSING"
  | "RELEASE_NOTES_OUTPUT_MISSING"
  | "RELEASE_NOTES_FILE_MISSING"
  | "RELEASE_NOTES_PATH_MISMATCH"
  | "RELEASE_TAG_REF_DRIFT"
  | "RELEASE_GENERATED_NOTES_FORBIDDEN"
  | "RELEASE_ORDER_INVALID"
  | "RELEASE_TIMEOUT_MISSING";

export interface ReleaseTagIssue {
  code: ReleaseTagIssueCode;
  path: string;
  detail: string;
}

export interface ReleaseTagAuditInput {
  tagName: string;
  packageVersion: string;
  changelog: string;
  /** 可注入契约，便于单测构造反例。 */
  contract?: ReleaseTagContract;
}

export interface ReleaseTagAuditReport {
  issues: ReleaseTagIssue[];
  checks: number;
  notes?: ReleaseNotes;
}

export interface ReleaseWorkflowAuditInput {
  workflow: string;
  contract?: ReleaseTagContract;
}

export interface ReleaseWorkflowAuditReport {
  issues: ReleaseTagIssue[];
  checks: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function issue(
  contract: ReleaseTagContract,
  code: ReleaseTagIssueCode,
  detail: string,
  path = contract.changelogPath,
): ReleaseTagIssue {
  return { code, path, detail };
}

/** 严格解析仓库使用的发布版本（三段数字，不接受预发布后缀）。 */
export function parseReleaseVersion(value: string): string | null {
  const trimmed = value.trim();
  return VERSION_PATTERN.test(trimmed) ? trimmed : null;
}

/** 从 `vX.Y.Z` 标签取版本；前缀不匹配时返回空字符串。 */
export function versionFromTag(tagName: string, prefix = RELEASE_TAG_CONTRACT.tagPrefix): string {
  return tagName.startsWith(prefix) ? tagName.slice(prefix.length).trim() : "";
}

/** 判断 YYYY-MM-DD 是否是真实存在的 UTC 日期。 */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * 从 CHANGELOG 提取指定已发布版本的章节。
 * 标题格式与 `check:changelog` 一致：`## [x.y.z] — YYYY-MM-DD`（也接受 ASCII `-`）。
 */
export function extractChangelogEntry(
  changelog: string,
  version: string,
): ChangelogEntry | undefined {
  const heading = new RegExp(
    `^##\\s+\\[${escapeRegExp(version)}\\]\\s+[—-]\\s+(\\d{4}-\\d{2}-\\d{2})\\s*$`,
    "m",
  );
  const match = heading.exec(changelog);
  if (!match || match.index === undefined) return undefined;

  const remainder = changelog.slice(match.index + match[0].length);
  const nextHeading = /^##\s+/m.exec(remainder);
  const body = (nextHeading ? remainder.slice(0, nextHeading.index) : remainder).trim();
  return { version, date: match[1], body };
}

/** 生成 GitHub Release Notes（标题 + 同版本 CHANGELOG 正文）。 */
export function buildReleaseNotes(tagName: string, entry: ChangelogEntry): ReleaseNotes {
  return {
    version: entry.version,
    tagName,
    date: entry.date,
    title: tagName,
    body: `## ${tagName} — ${entry.date}\n\n${entry.body}\n`,
  };
}

function auditPackageVersion(
  rawVersion: string,
  contract: ReleaseTagContract,
): { version: string | null; issues: ReleaseTagIssue[] } {
  const version = parseReleaseVersion(rawVersion);
  if (version) return { version, issues: [] };
  return {
    version: null,
    issues: [
      issue(
        contract,
        "RELEASE_PACKAGE_VERSION_INVALID",
        `package.json version 必须是 x.y.z，当前为 ${rawVersion || "(空)"}`,
      ),
    ],
  };
}

function auditTagVersion(
  tagName: string,
  packageVersion: string | null,
  contract: ReleaseTagContract,
): { version: string; issues: ReleaseTagIssue[] } {
  const issues: ReleaseTagIssue[] = [];

  if (!tagName.startsWith(contract.tagPrefix)) {
    issues.push(
      issue(
        contract,
        "RELEASE_TAG_PREFIX_MISSING",
        `发布标签必须以 ${contract.tagPrefix} 开头，当前为 ${tagName || "(空)"}`,
      ),
    );
  }

  const tagVersion = versionFromTag(tagName, contract.tagPrefix);
  if (!tagVersion || !parseReleaseVersion(tagVersion)) {
    issues.push(
      issue(
        contract,
        "RELEASE_TAG_VERSION_INVALID",
        `发布标签必须以 ${contract.tagPrefix}x.y.z 结尾，当前为 ${tagName || "(空)"}`,
      ),
    );
  } else if (packageVersion && tagVersion !== packageVersion) {
    issues.push(
      issue(
        contract,
        "RELEASE_TAG_VERSION_MISMATCH",
        `标签版本 ${tagVersion} 与 package.json ${packageVersion} 不一致`,
      ),
    );
  }

  return { version: tagVersion, issues };
}

function auditChangelogEntry(
  changelog: string,
  packageVersion: string | null,
  contract: ReleaseTagContract,
): { entry: ChangelogEntry | undefined; issues: ReleaseTagIssue[] } {
  const issues: ReleaseTagIssue[] = [];
  const entry = packageVersion ? extractChangelogEntry(changelog, packageVersion) : undefined;

  if (!entry) {
    issues.push(
      issue(
        contract,
        "RELEASE_CHANGELOG_ENTRY_MISSING",
        `CHANGELOG 缺少 [${packageVersion ?? "?"}] 已发布章节`,
      ),
    );
  } else {
    if (entry.body.length === 0) {
      issues.push(
        issue(contract, "RELEASE_CHANGELOG_ENTRY_EMPTY", `[${entry.version}] 章节正文为空`),
      );
    }
    if (!isValidIsoDate(entry.date)) {
      issues.push(
        issue(
          contract,
          "RELEASE_CHANGELOG_DATE_INVALID",
          `[${entry.version}] 的发布日期 ${entry.date} 不是合法日期`,
        ),
      );
    }
  }

  return { entry, issues };
}

/** 审计标签、package.json 版本与 CHANGELOG 章节是否一致。 */
export function auditReleaseTag(input: ReleaseTagAuditInput): ReleaseTagAuditReport {
  const contract = input.contract ?? RELEASE_TAG_CONTRACT;
  const packageReport = auditPackageVersion(input.packageVersion, contract);
  const tagReport = auditTagVersion(input.tagName, packageReport.version, contract);
  const changelogReport = auditChangelogEntry(input.changelog, packageReport.version, contract);

  const notes =
    changelogReport.entry && packageReport.version && tagReport.version === packageReport.version
      ? buildReleaseNotes(input.tagName, changelogReport.entry)
      : undefined;
  return {
    issues: [...packageReport.issues, ...tagReport.issues, ...changelogReport.issues],
    checks: 7,
    notes,
  };
}

function hasTagTrigger(workflow: string): boolean {
  return (
    /tags:\s*\n\s*-\s*["']?v\*["']?/.test(workflow) ||
    /tags:\s*\[\s*["']?v\*["']?\s*\]/.test(workflow)
  );
}

function pnpmScriptPattern(script: string): RegExp {
  return new RegExp(`pnpm\\s+(?:--silent\\s+)?${escapeRegExp(script)}(?![\\w:-])`);
}

function findCommandLine(workflow: string, pattern: RegExp): string {
  const lines = workflow.split(/\r?\n/);
  const executablePattern = new RegExp(`(?:^|(?:&&|\\|\\||;)\\s*)${pattern.source}`);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*#/.test(line)) continue;
    if (!executablePattern.test(line.trim())) continue;
    let command = line.trim();
    while (/\\\s*$/.test(command) && index + 1 < lines.length) {
      command = `${command.replace(/\\\s*$/, " ")}${lines[index + 1].trim()}`;
      index += 1;
    }
    return command;
  }
  return "";
}

function optionValue(commandLine: string, option: string): string {
  const pattern = new RegExp(
    `${escapeRegExp(option)}(?:\\s+|=)(?:"([^"]*)"|'([^']*)'|(\\S+))`,
  );
  const match = pattern.exec(commandLine);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function usesGitHubRefName(value: string): boolean {
  return /^\$(?:GITHUB_REF_NAME|\{GITHUB_REF_NAME\})$/.test(value);
}

function commandPrecedes(workflow: string, before: string, after: string): boolean {
  if (!before || !after) return false;
  const commandKey = (command: string) =>
    command.trim().match(/^(\S+\s+\S+)/)?.[1] ?? command.trim();
  const beforeIndex = workflow.indexOf(commandKey(before));
  const afterIndex = workflow.indexOf(commandKey(after));
  return beforeIndex !== -1 && afterIndex !== -1 && beforeIndex < afterIndex;
}

function addWhenMissing(
  add: (code: ReleaseTagIssueCode, detail: string) => void,
  condition: boolean,
  code: ReleaseTagIssueCode,
  detail: string,
): void {
  if (!condition) add(code, detail);
}

function workflowWithoutComments(workflow: string): string {
  return workflow
    .split(/\r?\n/)
    .filter((line) => !/^[ \t]*#/.test(line))
    .join("\n");
}

/** 从 YAML 的 `run:` 步骤提取真正会交给 shell 的文本，排除注释和普通字符串字段。 */
function executableScripts(workflow: string): string {
  const scripts: string[] = [];
  let blockIndent: number | null = null;

  for (const line of workflow.split(/\r?\n/)) {
    const run = /^(\s*)run:\s*(.*)$/.exec(line);
    if (run) {
      const indent = run[1].length;
      const value = run[2].trim();
      if (/^[|>]/.test(value)) {
        blockIndent = indent;
      } else {
        blockIndent = null;
        if (!/^["']/.test(value)) scripts.push(value.replace(/\s+#.*$/, ""));
      }
      continue;
    }

    if (blockIndent === null) continue;
    const trimmed = line.trim();
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (trimmed !== "" && indent <= blockIndent) {
      blockIndent = null;
      continue;
    }
    scripts.push(line.trim().replace(/\s+#.*$/, ""));
  }

  return scripts.join("\n");
}

/** 审计 release.yml 是否真正在创建 Release 前执行发布门禁并消费 CHANGELOG notes。 */
export function auditReleaseWorkflow(input: ReleaseWorkflowAuditInput): ReleaseWorkflowAuditReport {
  const contract = input.contract ?? RELEASE_TAG_CONTRACT;
  const workflow = workflowWithoutComments(input.workflow ?? "");
  const scripts = executableScripts(workflow);
  const issues: ReleaseTagIssue[] = [];
  const path = contract.workflowPath;
  const add = (code: ReleaseTagIssueCode, detail: string) => {
    issues.push({ code, path, detail });
  };

  if (workflow.trim().length === 0) {
    add("RELEASE_WORKFLOW_MISSING", `${path} 缺失或为空，发布入口无法审计`);
    return { issues, checks: 15 };
  }

  const gateCommand = contract.requiredGateCommands[0];
  const tagCheckCommand = contract.requiredGateCommands[1];
  const gateLine = findCommandLine(scripts, pnpmScriptPattern(gateCommand.slice(5)));
  const tagCheckLine = findCommandLine(scripts, pnpmScriptPattern(tagCheckCommand.slice(5)));
  const releaseLine = findCommandLine(scripts, /gh\s+release\s+create\b/);
  const tagValue = optionValue(tagCheckLine, "--tag");
  const notesOutput = optionValue(tagCheckLine, "--notes-output");
  const notesFile = optionValue(releaseLine, contract.requiredNotesFlag);

  addWhenMissing(
    add,
    hasTagTrigger(workflow),
    "RELEASE_TRIGGER_DRIFT",
    "release workflow 必须由 v* tag push 触发",
  );
  addWhenMissing(
    add,
    /^[ \t]*contents:[ \t]*write[ \t]*$/m.test(workflow),
    "RELEASE_PERMISSION_MISSING",
    "创建 GitHub Release 需要 contents: write 权限",
  );
  addWhenMissing(
    add,
    /fetch-depth:[ \t]*["']?0["']?/.test(workflow),
    "RELEASE_FETCH_DEPTH_DRIFT",
    "release workflow 必须全历史 checkout（fetch-depth: 0）",
  );
  addWhenMissing(
    add,
    /pnpm\s+(?:install|i)\s+--frozen-lockfile/.test(scripts),
    "RELEASE_INSTALL_MISSING",
    "创建 Release 前必须用 pnpm --frozen-lockfile 安装锁文件依赖",
  );
  addWhenMissing(
    add,
    gateLine.length > 0,
    "RELEASE_GATE_MISSING",
    `创建 Release 前必须运行 ${gateCommand}`,
  );
  addWhenMissing(
    add,
    tagCheckLine.length > 0,
    "RELEASE_TAG_CHECK_MISSING",
    `创建 Release 前必须运行 ${tagCheckCommand}`,
  );
  addWhenMissing(
    add,
    usesGitHubRefName(tagValue),
    "RELEASE_TAG_REF_DRIFT",
    `${tagCheckCommand} 必须显式传入 --tag "$GITHUB_REF_NAME"`,
  );
  addWhenMissing(
    add,
    notesOutput.length > 0,
    "RELEASE_NOTES_OUTPUT_MISSING",
    `${tagCheckCommand} 必须用 --notes-output 生成 Release Notes`,
  );
  addWhenMissing(
    add,
    releaseLine.length > 0,
    "RELEASE_NOTES_FILE_MISSING",
    "release workflow 必须调用 gh release create",
  );
  addWhenMissing(
    add,
    notesFile.length > 0,
    "RELEASE_NOTES_FILE_MISSING",
    `gh release create 必须使用 ${contract.requiredNotesFlag}`,
  );
  addWhenMissing(
    add,
    !notesOutput || !notesFile || notesOutput === notesFile,
    "RELEASE_NOTES_PATH_MISMATCH",
    `${tagCheckCommand} 的 --notes-output 必须与 gh release create 的 ${contract.requiredNotesFlag} 指向同一文件`,
  );
  addWhenMissing(
    add,
    !new RegExp(escapeRegExp(contract.forbiddenNotesFlag)).test(workflow),
    "RELEASE_GENERATED_NOTES_FORBIDDEN",
    `禁止使用 ${contract.forbiddenNotesFlag}；Release Notes 必须来自 CHANGELOG`,
  );
  addWhenMissing(
    add,
    commandPrecedes(scripts, gateLine, releaseLine) &&
      commandPrecedes(scripts, tagCheckLine, releaseLine),
    "RELEASE_ORDER_INVALID",
    "pnpm check:all 与 check:release-tag 都必须在 gh release create 之前执行",
  );
  addWhenMissing(
    add,
    /timeout-minutes:[ \t]*\d+/.test(workflow),
    "RELEASE_TIMEOUT_MISSING",
    "release 作业必须设置 timeout-minutes",
  );

  return { issues, checks: 15 };
}

/** 合并标签/CHANGELOG 与 workflow 审计，供 CLI 与测试共用。 */
export function auditReleasePolicy(
  tagInput: ReleaseTagAuditInput,
  workflowInput: ReleaseWorkflowAuditInput,
): { issues: ReleaseTagIssue[]; checks: number; notes?: ReleaseNotes } {
  const tagReport = auditReleaseTag(tagInput);
  const workflowReport = auditReleaseWorkflow(workflowInput);
  return {
    issues: [...tagReport.issues, ...workflowReport.issues],
    checks: tagReport.checks + workflowReport.checks,
    notes: tagReport.notes,
  };
}

/** 格式化为带规则码的文本，供 CLI 与单测复用。 */
export function formatReleaseTagIssues(issues: readonly ReleaseTagIssue[]): string {
  return issues.map((item) => `❌ [${item.code}] ${item.path} ${item.detail}`).join("\n");
}
