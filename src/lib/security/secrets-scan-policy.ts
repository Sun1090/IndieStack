/**
 * Secrets Scan 扫描强度与泄漏处置策略门禁（J05）。
 *
 * 背景：`pnpm check:security` 已经用整文件正则确认「gitleaks 工作流还在、还带 fetch-depth: 0」，
 * 但正则看不到真正决定「密钥零回归」的东西：触发器是不是写在 `on:` 块里、`fetch-depth` 是不是
 * 真的给了 checkout、扫描作业是不是还有超时、`GITHUB_TOKEN` 是不是仍然接线，以及最危险的一项
 * ——**allowlist**。往 `.gitleaks.toml` 里加一条 `paths = ["src/**"]` 不会让任何现有检查变红，
 * 却能让整个仓库的扫描结果变成空集。
 *
 * 本模块把这些固化为可执行规则，全部为纯函数（不读文件系统）：
 *
 *   - `secrets-scan.yml` 必须保留 gitleaks 作业，action 固定在契约 major，作业有超时；
 *   - `push` 覆盖契约分支、`pull_request` 触发保留，权限只读且不得出现任何 `: write`；
 *   - checkout 必须 `fetch-depth: 0`（只扫最新提交等于放弃历史）；
 *   - 步骤 env 里 `GITHUB_TOKEN` / `GITLEAKS_LICENSE` 这类敏感键必须引用 `${{ secrets.* }}`，
 *     不得写字面量；自定义 config 路径必须与契约一致；
 *   - `.gitleaks.toml` 存在时，`[allowlist]` / `[[allowlists]]` 下的每条 paths / regexes /
 *     stopwords / commits 都必须登记在契约里（默认为空），排除范围不可悄悄扩大；
 *   - 泄漏处置 runbook 必须存在、含必备章节，并写明首次响应时限、轮换时限与允许的
 *     allowlist 理由——这些数字与工作流同源，文档漂移即失败。
 *
 * 抽取结果为空时失败封闭，避免正则/解析失效被当成「零问题」。
 * 真正的历史扫描结果在 GitHub side，需要推送后由 gitleaks 在 runner 上产生，不在本门禁范围内。
 */

import {
  actionRefVersion,
  isVersionAtMajor,
  parseJobs,
  parseStepRef,
  parseTriggerBranches,
  parseTriggers,
  type ParsedWorkflowJob,
} from "../ci/workflow-policy.ts";

export interface TextFile {
  path: string;
  content: string;
}

export interface SecretsScanContract {
  /** 工作流路径。 */
  path: string;
  /** gitleaks action 仓库。 */
  actionRepo: string;
  /** 受支持的 action major。 */
  actionMajor: string;
  /** 扫描作业 id。 */
  jobId: string;
  /** push 必须覆盖的分支。 */
  pushBranches: readonly string[];
  /** 是否必须保留 pull_request 触发。 */
  requirePullRequest: boolean;
  /** checkout 必须使用的 fetch-depth。 */
  requiredFetchDepth: string;
  /** gitleaks 配置路径；自定义 config 引用必须与它一致。 */
  configPath: string;
  /** 允许出现在 `.gitleaks.toml` allowlist 里的条目；默认为空。 */
  allowedAllowlistEntries: readonly string[];
  /** 泄漏处置 runbook 路径。 */
  runbookPath: string;
  /** runbook 必备章节标题片段。 */
  runbookSections: readonly string[];
  /** 发现疑似泄漏后的首次响应时限（分钟）。 */
  firstResponseMinutes: number;
  /** 受影响凭据的轮换完成时限（小时）。 */
  rotationHours: number;
  /** 允许的 allowlist 理由。 */
  allowlistReasons: readonly string[];
}

export const SECRETS_SCAN_CONTRACT: SecretsScanContract = {
  path: ".github/workflows/secrets-scan.yml",
  actionRepo: "gitleaks/gitleaks-action",
  actionMajor: "v3",
  jobId: "gitleaks",
  pushBranches: ["main", "develop"],
  requirePullRequest: true,
  requiredFetchDepth: "0",
  configPath: ".gitleaks.toml",
  allowedAllowlistEntries: [],
  runbookPath: "docs/operations/secrets-leak-response-runbook.md",
  runbookSections: [
    "适用范围",
    "立即响应",
    "影响范围判定",
    "处置与验证",
    "历史记录处理",
    "Allowlist 规则",
    "外部依赖",
  ],
  firstResponseMinutes: 10,
  rotationHours: 24,
  allowlistReasons: ["false positive", "used in tests"],
};

export interface SecretsEnvEntry {
  key: string;
  value: string;
}

export interface SecretsScanFacts {
  triggers: string[];
  pushBranches: string[];
  scanJob?: ParsedWorkflowJob;
  actionRef: string;
  fetchDepth: string;
  sensitiveEnv: SecretsEnvEntry[];
  hasContentsRead: boolean;
  writeScopes: string[];
  configReference: string;
}

export interface GitleaksAllowlistEntry {
  /** allowlist 段下的键：`paths` / `regexes` / `stopwords` / `commits`。 */
  key: string;
  value: string;
}

export type SecretsScanIssueCode =
  | "SECRETS_SOURCE_EMPTY"
  | "SECRETS_WORKFLOW_MISSING"
  | "SECRETS_JOB_MISSING"
  | "SECRETS_ACTION_MISSING"
  | "SECRETS_ACTION_MAJOR_DRIFT"
  | "SECRETS_FETCH_DEPTH_DRIFT"
  | "SECRETS_JOB_TIMEOUT_MISSING"
  | "SECRETS_PERMISSION_MISSING"
  | "SECRETS_WRITE_PERMISSION"
  | "SECRETS_TRIGGER_DRIFT"
  | "SECRETS_TOKEN_UNWIRED"
  | "SECRETS_ENV_LITERAL"
  | "SECRETS_CONFIG_REFERENCE_DRIFT"
  | "SECRETS_ALLOWLIST_UNREGISTERED"
  | "SECRETS_RUNBOOK_MISSING"
  | "SECRETS_RUNBOOK_SECTION_MISSING"
  | "SECRETS_RUNBOOK_FACT_MISSING";

export interface SecretsScanIssue {
  code: SecretsScanIssueCode;
  path: string;
  detail: string;
}

export interface SecretsScanPolicyInput {
  workflow?: TextFile;
  /** `.gitleaks.toml`；不存在时跳过 allowlist 规则。 */
  config?: TextFile;
  runbook?: TextFile;
  /** 可注入的契约，便于单测构造反例。 */
  contract?: SecretsScanContract;
}

export interface SecretsScanPolicyReport {
  issues: SecretsScanIssue[];
  checks: number;
}

/** 大写环境变量键（`GITHUB_TOKEN:` / `GITLEAKS_CONFIG:` 等），不匹配 YAML 的普通键。 */
const ENV_LINE = /^ {6,}([A-Z][A-Z0-9_]*):[ \t]*(.*?)[ \t]*$/;
const SENSITIVE_ENV_KEY = /(TOKEN|SECRET|KEY|LICENSE|PASSWORD|PASSWD|CREDENTIAL)/;
const SECRET_EXPRESSION = /^\$\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}$/;
const ALLOWLIST_KEYS = new Set(["paths", "regexes", "stopwords", "commits", "condition"]);
const ALLOWLIST_HEADER = /^\s*\[\[?([^\]]+)\]\]?\s*$/;
const ALLOWLIST_ASSIGNMENT = /^\s*([a-z][a-z-]*)\s*=\s*(.*)$/;
const STRING_LITERAL = /"""([\s\S]*?)"""|'''([\s\S]*?)'''|"([^"]*)"|'([^']*)'/g;

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

/** 判断 action 引用是否固定到契约仓库与 major。 */
export function actionRefMatches(ref: string, contract: SecretsScanContract): boolean {
  const path = ref.split("@")[0];
  if (path !== contract.actionRepo) return false;
  return isVersionAtMajor(actionRefVersion(ref), contract.actionMajor);
}

/** 步骤 env 里的敏感键：值必须是 `${{ secrets.* }}` 表达式，不能是字面量。 */
export function collectSensitiveEnv(body: string): SecretsEnvEntry[] {
  const entries: SecretsEnvEntry[] = [];
  for (const line of body.split("\n")) {
    const match = ENV_LINE.exec(line);
    if (!match) continue;
    if (!SENSITIVE_ENV_KEY.test(match[1])) continue;
    entries.push({ key: match[1], value: match[2] });
  }
  return entries;
}

/** 工作流里引用到的自定义 gitleaks 配置路径；没有引用时返回空串。 */
export function configReference(body: string): string {
  const envValue = /^[ \t]+GITLEAKS_CONFIG:[ \t]*(.+?)[ \t]*$/m.exec(body)?.[1];
  if (envValue !== undefined && envValue.length > 0) return stripQuotes(envValue);
  const argument = /--config[= ][ \t]*(\S+)/.exec(body)?.[1];
  if (argument !== undefined) return stripQuotes(argument);
  const input = /^[ \t]+config:[ \t]*(.+?)[ \t]*$/m.exec(body)?.[1];
  return input === undefined ? "" : stripQuotes(input);
}

/** 抽取 TOML 数组/单值里的字符串字面量。 */
function extractStrings(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(STRING_LITERAL)) {
    const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
    if (value.length > 0) values.push(value);
  }
  return values;
}

/** 把可能跨行的 TOML 数组拼成一段文本，并返回消费到的最后一行。 */
function collectValueText(
  inline: string,
  lines: readonly string[],
  index: number,
): { text: string; lastIndex: number } {
  let text = inline;
  let lastIndex = index;
  if (text.includes("[") && !text.includes("]")) {
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      text += ` ${lines[cursor]}`;
      lastIndex = cursor;
      if (lines[cursor].includes("]")) break;
    }
  }
  return { text, lastIndex };
}

/**
 * 抽取 `.gitleaks.toml` 里 `[allowlist]` / `[[allowlists]]` 段的条目。
 * 只认登记过的键（paths / regexes / stopwords / commits / condition）。
 */
export function parseGitleaksAllowlists(content: string): GitleaksAllowlistEntry[] {
  const entries: GitleaksAllowlistEntry[] = [];
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let inAllowlist = false;

  for (let index = 0; index < lines.length; index += 1) {
    const header = ALLOWLIST_HEADER.exec(lines[index]);
    if (header) {
      inAllowlist = /^allowlists?$/.test(header[1].trim());
      continue;
    }
    if (!inAllowlist) continue;
    const assignment = ALLOWLIST_ASSIGNMENT.exec(lines[index]);
    if (!assignment || !ALLOWLIST_KEYS.has(assignment[1])) continue;
    const { text, lastIndex } = collectValueText(assignment[2], lines, index);
    index = lastIndex;
    for (const value of extractStrings(text)) entries.push({ key: assignment[1], value });
  }
  return entries;
}

/** 分析 secrets-scan.yml 文本，抽出契约关心的全部事实。 */
export function parseSecretsScanWorkflow(
  content: string,
  contract: SecretsScanContract = SECRETS_SCAN_CONTRACT,
): SecretsScanFacts {
  const normalized = content.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const scanJob = parseJobs(lines).find((job) => job.id === contract.jobId);
  const body = scanJob?.body ?? "";
  const writeScopes = [...normalized.matchAll(/^[ \t]{0,6}([a-z-]+):[ \t]*write[ \t]*$/gm)].map(
    (match) => match[1],
  );
  return {
    triggers: parseTriggers(lines),
    pushBranches: parseTriggerBranches(lines, "push"),
    scanJob,
    actionRef: parseStepRef(body, contract.actionRepo),
    fetchDepth: /^[ \t]+fetch-depth:[ \t]*["']?(\d+)["']?[ \t]*$/m.exec(body)?.[1] ?? "",
    sensitiveEnv: collectSensitiveEnv(body),
    hasContentsRead: /contents:\s*read/.test(normalized),
    writeScopes,
    configReference: configReference(body),
  };
}

function workflowIssue(
  contract: SecretsScanContract,
  code: SecretsScanIssueCode,
  detail: string,
): SecretsScanIssue {
  return { code, path: contract.path, detail };
}

function auditScanJob(
  facts: SecretsScanFacts,
  contract: SecretsScanContract,
  issues: SecretsScanIssue[],
): void {
  if (!facts.scanJob) {
    issues.push(
      workflowIssue(contract, "SECRETS_JOB_MISSING", `必须保留 ${contract.jobId} 扫描作业`),
    );
    return;
  }
  if (facts.actionRef.length === 0) {
    issues.push(
      workflowIssue(
        contract,
        "SECRETS_ACTION_MISSING",
        `${contract.actionRepo} 步骤缺失，扫描不会执行`,
      ),
    );
  } else if (!actionRefMatches(facts.actionRef, contract)) {
    issues.push(
      workflowIssue(
        contract,
        "SECRETS_ACTION_MAJOR_DRIFT",
        `扫描必须固定在 ${contract.actionRepo}@${contract.actionMajor}，当前为 ${facts.actionRef}`,
      ),
    );
  }
  if (facts.fetchDepth !== contract.requiredFetchDepth) {
    issues.push(
      workflowIssue(
        contract,
        "SECRETS_FETCH_DEPTH_DRIFT",
        `checkout 必须 fetch-depth: ${contract.requiredFetchDepth}（只扫最新提交会漏掉历史泄漏），当前为 ${facts.fetchDepth || "(未设置)"}`,
      ),
    );
  }
  if (!facts.scanJob.hasTimeout) {
    issues.push(
      workflowIssue(contract, "SECRETS_JOB_TIMEOUT_MISSING", "扫描作业必须设置 timeout-minutes"),
    );
  }
  const token = facts.sensitiveEnv.find((entry) => entry.key === "GITHUB_TOKEN");
  if (!token) {
    issues.push(
      workflowIssue(
        contract,
        "SECRETS_TOKEN_UNWIRED",
        "扫描步骤必须接线 GITHUB_TOKEN，否则无法读取仓库与上报结果",
      ),
    );
  }
  for (const entry of facts.sensitiveEnv) {
    if (SECRET_EXPRESSION.test(entry.value)) continue;
    issues.push(
      workflowIssue(
        contract,
        "SECRETS_ENV_LITERAL",
        `${entry.key} 必须引用 \${{ secrets.* }}，禁止把凭据写成字面量`,
      ),
    );
  }
  if (facts.configReference.length > 0 && facts.configReference !== contract.configPath) {
    issues.push(
      workflowIssue(
        contract,
        "SECRETS_CONFIG_REFERENCE_DRIFT",
        `自定义 gitleaks 配置必须指向 ${contract.configPath}，当前为 ${facts.configReference}`,
      ),
    );
  }
}

function auditPermissionsAndTriggers(
  facts: SecretsScanFacts,
  contract: SecretsScanContract,
  issues: SecretsScanIssue[],
): void {
  if (!facts.hasContentsRead) {
    issues.push(
      workflowIssue(contract, "SECRETS_PERMISSION_MISSING", "工作流必须声明 contents: read"),
    );
  }
  if (facts.writeScopes.length > 0) {
    issues.push(
      workflowIssue(
        contract,
        "SECRETS_WRITE_PERMISSION",
        `密钥扫描只需要只读权限，禁止 ${facts.writeScopes.join(", ")}: write`,
      ),
    );
  }
  if (!facts.triggers.includes("push")) {
    issues.push(workflowIssue(contract, "SECRETS_TRIGGER_DRIFT", "必须保留 push 触发"));
  } else {
    for (const branch of contract.pushBranches) {
      if (facts.pushBranches.includes(branch)) continue;
      issues.push(workflowIssue(contract, "SECRETS_TRIGGER_DRIFT", `push 必须覆盖分支 ${branch}`));
    }
  }
  if (contract.requirePullRequest && !facts.triggers.includes("pull_request")) {
    issues.push(workflowIssue(contract, "SECRETS_TRIGGER_DRIFT", "必须保留 pull_request 触发"));
  }
}

function auditAllowlist(
  config: TextFile | undefined,
  contract: SecretsScanContract,
  issues: SecretsScanIssue[],
): void {
  if (!config) return;
  for (const entry of parseGitleaksAllowlists(config.content)) {
    if (contract.allowedAllowlistEntries.includes(entry.value)) continue;
    issues.push({
      code: "SECRETS_ALLOWLIST_UNREGISTERED",
      path: config.path,
      detail: `${entry.key} 里的 ${entry.value} 未登记在契约中；allowlist 会让扫描结果悄悄变空`,
    });
  }
}

function auditRunbook(
  runbook: TextFile | undefined,
  contract: SecretsScanContract,
  issues: SecretsScanIssue[],
): void {
  if (!runbook || runbook.content.trim().length === 0) {
    issues.push({
      code: "SECRETS_RUNBOOK_MISSING",
      path: contract.runbookPath,
      detail: `${contract.runbookPath} 缺失或为空，泄漏处置流程没有单一事实来源`,
    });
    return;
  }
  for (const section of contract.runbookSections) {
    if (runbook.content.includes(section)) continue;
    issues.push({
      code: "SECRETS_RUNBOOK_SECTION_MISSING",
      path: runbook.path,
      detail: `缺少必备章节「${section}」`,
    });
  }
  const facts: Array<[string, string]> = [
    [`${contract.firstResponseMinutes} 分钟`, `首次响应时限 ${contract.firstResponseMinutes} 分钟`],
    [`${contract.rotationHours} 小时`, `轮换时限 ${contract.rotationHours} 小时`],
    [`fetch-depth: ${contract.requiredFetchDepth}`, "全历史扫描要求 fetch-depth: 0"],
    ...contract.allowlistReasons.map(
      (reason) => [reason, `允许的 allowlist 理由 ${reason}`] as [string, string],
    ),
  ];
  for (const [token, label] of facts) {
    if (runbook.content.includes(token)) continue;
    issues.push({
      code: "SECRETS_RUNBOOK_FACT_MISSING",
      path: runbook.path,
      detail: `runbook 缺少事实：${label}`,
    });
  }
}

/** 审计 Secrets Scan 扫描强度与泄漏处置策略；纯函数，不读取文件系统。 */
export function auditSecretsScanPolicy(input: SecretsScanPolicyInput): SecretsScanPolicyReport {
  const contract = input.contract ?? SECRETS_SCAN_CONTRACT;
  const issues: SecretsScanIssue[] = [];
  const workflow = input.workflow;

  if (!workflow || workflow.content.trim().length === 0) {
    issues.push({
      code: workflow ? "SECRETS_SOURCE_EMPTY" : "SECRETS_WORKFLOW_MISSING",
      path: workflow?.path ?? contract.path,
      detail: `${contract.path} 缺失或为空，密钥扫描强度无法确认`,
    });
  } else {
    const facts = parseSecretsScanWorkflow(workflow.content, contract);
    auditScanJob(facts, contract, issues);
    auditPermissionsAndTriggers(facts, contract, issues);
  }
  auditAllowlist(input.config, contract, issues);
  auditRunbook(input.runbook, contract, issues);

  const checks =
    contract.pushBranches.length +
    contract.runbookSections.length +
    contract.allowlistReasons.length +
    9;
  return { issues, checks };
}

/** 输出格式：带规则码，CLI 与单测共用。 */
export function formatSecretsScanIssues(issues: readonly SecretsScanIssue[]): string {
  return issues.map((item) => `❌ [${item.code}] ${item.path} ${item.detail}`).join("\n");
}
