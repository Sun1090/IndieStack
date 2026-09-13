/**
 * CodeQL 扫描与告警处置策略门禁（J04）。
 *
 * 背景：`pnpm check:security` 只断言「CodeQL 还开着」——analyze action 还是 v4、还是
 * `security-extended`、还有 `security-events: write`。但真正决定「告警零回归」能否成立的是
 * 更细的契约：语言是否覆盖、`paths-ignore` 是否悄悄排除了自家源码、分类 category 是否漂移、
 * 定时扫描是否还在每周跑、分析超时是否存在，以及**告警怎么处置**——严重度阈值、修复
 * SLA、允许的 dismissal 理由有没有写在文档里并与工作流一致。
 *
 * 本模块把「扫描强度」和「告警处置」都固化为可执行规则，全部为纯函数：
 *
 *   - `init` / `analyze` 必须同时存在且固定在同一 major（`github/codeql-action@v4`）；
 *   - 语言必须覆盖契约里的每一种，查询套件不得比契约更窄；
 *   - analyze 作业必须保留 `security-events: write` 与 `timeout-minutes`；
 *   - `push` / `pull_request` 的分支覆盖与「每周一次」的 schedule 必须保持；
 *   - `paths-ignore` 只允许契约里登记过的条目（默认空），`paths` 白名单不得漏掉源码前缀；
 *   - 处置 runbook 必须存在、含必备章节，并写明套件名、阻断严重度、修复 SLA 与允许的
 *     dismissal 理由——这些数字与工作流同源，文档漂移即失败。
 *
 * 抽取结果为空时失败封闭，避免正则失效被当成「零问题」。
 * 真实告警数量对比需要 GitHub 安全 API，属外部依赖，不在本门禁范围内。
 */

import { parseJobs, parseTriggers, type ParsedWorkflowJob } from "../ci/workflow-policy.ts";

export interface TextFile {
  path: string;
  content: string;
}

export interface CodeqlContract {
  /** 工作流路径。 */
  path: string;
  /** action 仓库前缀。 */
  actionRepo: string;
  /** 受支持的 action major。 */
  actionMajor: string;
  /** 必须被分析的语言。 */
  languages: readonly string[];
  /** 查询套件；更窄的套件视为弱化。 */
  querySuite: string;
  /** SARIF 分类，保持稳定才能沿用历史告警状态。 */
  category: string;
  /** push 必须覆盖的分支。 */
  pushBranches: readonly string[];
  /** pull_request 必须覆盖的分支。 */
  pullRequestBranches: readonly string[];
  /** 定时扫描的星期（0=周日，1=周一），必须存在且不能退化为每日。 */
  scheduleWeekday: number;
  /** 允许出现在 `paths-ignore` 里的路径；默认为空，即不允许任何排除。 */
  allowedIgnoredPaths: readonly string[];
  /** 代码必须被扫描的顶层前缀（`paths` 白名单不得漏掉它们）。 */
  sourcePrefixes: readonly string[];
  /** 处置 runbook 路径。 */
  triageDocPath: string;
  /** runbook 必备章节标题片段。 */
  triageDocSections: readonly string[];
  /** 触发合并阻断的 CodeQL security-severity 阈值。 */
  blockingSecuritySeverity: number;
  /** 从告警出现到完成分诊的 SLA（工作日）。 */
  triageSlaDays: number;
  /** 允许使用的 dismissal 理由（GitHub UI 内置选项）。 */
  dismissalReasons: readonly string[];
}

export const CODEQL_CONTRACT: CodeqlContract = {
  path: ".github/workflows/codeql.yml",
  actionRepo: "github/codeql-action",
  actionMajor: "v4",
  languages: ["javascript-typescript"],
  querySuite: "security-extended",
  category: "/language:javascript-typescript",
  pushBranches: ["main", "develop"],
  pullRequestBranches: ["main"],
  scheduleWeekday: 1,
  allowedIgnoredPaths: [],
  sourcePrefixes: ["src", "scripts", "e2e", "supabase"],
  triageDocPath: "docs/operations/codeql-alert-triage.md",
  triageDocSections: [
    "适用范围",
    "严重度与阻断阈值",
    "分诊流程",
    "Dismissal 规则",
    "零回归的判定",
    "外部依赖",
  ],
  blockingSecuritySeverity: 7.0,
  triageSlaDays: 5,
  dismissalReasons: ["false positive", "won't fix", "used in tests"],
};

export interface CodeqlWorkflowFacts {
  triggers: string[];
  pushBranches: string[];
  pullRequestBranches: string[];
  crons: string[];
  analyzeJob?: ParsedWorkflowJob;
  initRef: string;
  analyzeRef: string;
  languages: string[];
  querySuite: string;
  category: string;
  hasSecurityEventsWrite: boolean;
  uploadDisabled: boolean;
  pathIncludes: string[];
  pathIgnores: string[];
}

export type CodeqlIssueCode =
  | "CODEQL_SOURCE_EMPTY"
  | "CODEQL_WORKFLOW_MISSING"
  | "CODEQL_ANALYZE_JOB_MISSING"
  | "CODEQL_INIT_MISSING"
  | "CODEQL_ACTION_MAJOR_DRIFT"
  | "CODEQL_ACTION_MAJOR_MISMATCH"
  | "CODEQL_LANGUAGE_DRIFT"
  | "CODEQL_QUERY_SUITE_WEAKENED"
  | "CODEQL_PERMISSION_MISSING"
  | "CODEQL_CATEGORY_DRIFT"
  | "CODEQL_SCHEDULE_MISSING"
  | "CODEQL_SCHEDULE_CADENCE_DRIFT"
  | "CODEQL_BRANCH_COVERAGE_DRIFT"
  | "CODEQL_TIMEOUT_MISSING"
  | "CODEQL_UPLOAD_DISABLED"
  | "CODEQL_PATH_IGNORE_UNREGISTERED"
  | "CODEQL_PATHS_MISSING_SOURCE"
  | "CODEQL_TRIAGE_DOC_MISSING"
  | "CODEQL_TRIAGE_SECTION_MISSING"
  | "CODEQL_TRIAGE_FACT_MISSING";

export interface CodeqlIssue {
  code: CodeqlIssueCode;
  path: string;
  detail: string;
}

export interface CodeqlPolicyInput {
  workflow?: TextFile;
  triageDoc?: TextFile;
  /** 可注入的契约，便于单测构造反例。 */
  contract?: CodeqlContract;
}

export interface CodeqlPolicyReport {
  issues: CodeqlIssue[];
  checks: number;
}

const TRIGGER_HEADER = /^([A-Za-z_][A-Za-z0-9_-]*):\s*$/;
const CRON_LINE = /^[ \t]*-[ \t]*cron:[ \t]*["']?([^"'\n]+?)["']?[ \t]*$/gm;
const KEY_VALUE = /^ {4}([a-z-]+):\s*(.*)$/;

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function splitInlineList(value: string): string[] {
  return value
    .split(",")
    .map((item) => stripQuotes(item))
    .filter((item) => item.length > 0);
}

/**
 * 取 `on:` 块下某个触发器的子块正文（含缩进），用于读 `branches:` 这类二级配置。
 * 找不到时返回空字符串，由调用方按「缺覆盖」处理。
 */
function triggerBlock(lines: readonly string[], trigger: string): string {
  const start = lines.findIndex((line) => /^on:(\s|$)/.test(line));
  if (start === -1) return "";
  let inTrigger = false;
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length > 0 && /^\S/.test(line)) break;
    if (inTrigger) {
      if (/^ {2}\S/.test(line)) break;
      body.push(line);
      continue;
    }
    const header = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):/.exec(line);
    if (header && header[1] === trigger) {
      inTrigger = true;
      const inline = line.slice(header[0].length).trim();
      if (inline.length > 0) return inline;
    }
  }
  return body.join("\n");
}

/** 读取触发器子块里的 `branches:`（支持内联数组与块列表）。 */
function triggerBranches(lines: readonly string[], trigger: string): string[] {
  const block = triggerBlock(lines, trigger);
  if (block.length === 0) return [];
  return parseListBlock(block, "branches");
}

/** 解析形如 `branches: [main, develop]` 或 `branches:` + `- main` 的列表值。 */
function parseListBlock(block: string, key: string): string[] {
  const lines = block.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = new RegExp(`^\\s*${key}:\\s*(.*)$`).exec(lines[index]);
    if (!match) continue;
    const inline = match[1].trim();
    if (inline.startsWith("[")) return splitInlineList(inline.replace(/^\[|\]$/g, ""));
    if (inline.length > 0 && inline !== "|") return [stripQuotes(inline)];
    const items: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const item = /^\s*-\s*(\S+)\s*$/.exec(lines[cursor]);
      if (!item) break;
      items.push(stripQuotes(item[1]));
    }
    return items;
  }
  return [];
}

function parseCrons(content: string): string[] {
  return [...content.matchAll(CRON_LINE)].map((match) => match[1]);
}

/** 从作业正文里取某个 step 的 `uses:` 引用；同一个 action 出现多次时取最后一个。 */
function stepRef(body: string, actionPath: string): string {
  const pattern = new RegExp(`uses:\\s*(${actionPath}@\\S+)`, "g");
  return [...body.matchAll(pattern)].at(-1)?.[1] ?? "";
}

function parseWithValue(body: string, key: string): string {
  const match = new RegExp(`^\\s+${key}:\\s*(.+?)\\s*$`, "m").exec(body);
  return match ? stripQuotes(match[1]) : "";
}

/** 读取 init step 的 `with:` 列表（`languages` / `queries` 支持逗号分隔）。 */
function withList(body: string, key: string): string[] {
  const value = parseWithValue(body, key);
  if (value.length === 0) return [];
  return splitInlineList(value);
}

/**
 * 读取 `push` / `pull_request` 触发块里的 `paths:` / `paths-ignore:`。
 * GitHub 只在触发器下支持这两个键——写在作业里既不生效也骗不过门禁，因此这里
 * 只认触发器块，避免「排除自家源码」的改动绕过扫描范围检查。
 */
function triggerPaths(lines: readonly string[], key: string): string[] {
  const found: string[] = [];
  for (const trigger of ["push", "pull_request"]) {
    const block = triggerBlock(lines, trigger);
    if (block.length === 0) continue;
    found.push(...parseListBlock(block, key));
  }
  return found;
}

/** 分析工作流文本，抽出 CodeQL 契约关心的全部事实。 */
export function parseCodeqlWorkflow(
  content: string,
  contract: CodeqlContract = CODEQL_CONTRACT,
): CodeqlWorkflowFacts {
  const normalized = content.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const jobs = parseJobs(lines);
  const analyzeJob = jobs.find((job) => job.id === "analyze");
  const body = analyzeJob?.body ?? "";
  return {
    triggers: parseTriggers(lines),
    pushBranches: triggerBranches(lines, "push"),
    pullRequestBranches: triggerBranches(lines, "pull_request"),
    crons: parseCrons(normalized),
    analyzeJob,
    initRef: stepRef(body, `${contract.actionRepo}/init`),
    analyzeRef: stepRef(body, `${contract.actionRepo}/analyze`),
    languages: withList(body, "languages"),
    querySuite: parseWithValue(body, "queries"),
    category: parseWithValue(body, "category"),
    hasSecurityEventsWrite: /security-events:\s*write/.test(body),
    uploadDisabled: /^\s+upload:\s*false\s*$/m.test(body),
    pathIncludes: triggerPaths(lines, "paths"),
    pathIgnores: triggerPaths(lines, "paths-ignore"),
  };
}

/** 检查 action 引用是否固定到契约 major（如 `github/codeql-action/init@v4`）。 */
export function actionMajorMatches(ref: string, contract: CodeqlContract): boolean {
  const prefix = `${contract.actionRepo}/`;
  if (!ref.startsWith(prefix)) return false;
  const [path, version] = ref.split("@");
  if (!path.startsWith(prefix) || version === undefined) return false;
  if (version === contract.actionMajor) return true;
  // 允许更细的补丁固定（`@v4.1.2`），但禁止跨 major（`@v3` / `@v5`）。
  return version.startsWith(`${contract.actionMajor}.`);
}

function workflowIssue(
  contract: CodeqlContract,
  code: CodeqlIssueCode,
  detail: string,
): CodeqlIssue {
  return { code, path: contract.path, detail };
}

/** 判断 cron 是否为「每周一次」：日期/月份字段为 `*`，星期字段等于契约星期。 */
export function isWeeklyCron(cron: string, weekday: number): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [, , dayOfMonth, month, dayOfWeek] = fields;
  return dayOfMonth === "*" && month === "*" && dayOfWeek === String(weekday);
}

function auditWorkflowIdentity(
  facts: CodeqlWorkflowFacts,
  contract: CodeqlContract,
  issues: CodeqlIssue[],
): void {
  if (!facts.analyzeJob) {
    issues.push(
      workflowIssue(contract, "CODEQL_ANALYZE_JOB_MISSING", "codeql.yml 必须保留 analyze 作业"),
    );
    return;
  }
  if (facts.initRef.length === 0) {
    issues.push(
      workflowIssue(
        contract,
        "CODEQL_INIT_MISSING",
        `${contract.actionRepo}/init 步骤缺失，analyze 无法建立数据库`,
      ),
    );
  } else if (!actionMajorMatches(facts.initRef, contract)) {
    issues.push(
      workflowIssue(
        contract,
        "CODEQL_ACTION_MAJOR_DRIFT",
        `init 必须固定在 ${contract.actionRepo}@${contract.actionMajor}，当前为 ${facts.initRef}`,
      ),
    );
  }
  if (facts.analyzeRef.length === 0) {
    issues.push(
      workflowIssue(contract, "CODEQL_ANALYZE_JOB_MISSING", "analyze 步骤缺失，扫描不会产生 SARIF"),
    );
  } else if (!actionMajorMatches(facts.analyzeRef, contract)) {
    issues.push(
      workflowIssue(
        contract,
        "CODEQL_ACTION_MAJOR_DRIFT",
        `analyze 必须固定在 ${contract.actionRepo}@${contract.actionMajor}，当前为 ${facts.analyzeRef}`,
      ),
    );
  }
  if (facts.initRef.length > 0 && facts.analyzeRef.length > 0) {
    const initMajor = facts.initRef.split("@").at(-1);
    const analyzeMajor = facts.analyzeRef.split("@").at(-1);
    if (initMajor !== analyzeMajor) {
      issues.push(
        workflowIssue(
          contract,
          "CODEQL_ACTION_MAJOR_MISMATCH",
          `init (${initMajor}) 与 analyze (${analyzeMajor}) 必须使用同一版本`,
        ),
      );
    }
  }
}

function auditWorkflowAnalysis(
  facts: CodeqlWorkflowFacts,
  contract: CodeqlContract,
  issues: CodeqlIssue[],
): void {
  for (const language of contract.languages) {
    if (facts.languages.includes(language)) continue;
    issues.push(
      workflowIssue(
        contract,
        "CODEQL_LANGUAGE_DRIFT",
        `必须分析语言 ${language}，当前 languages = [${facts.languages.join(", ")}]`,
      ),
    );
  }
  if (facts.querySuite !== contract.querySuite) {
    issues.push(
      workflowIssue(
        contract,
        "CODEQL_QUERY_SUITE_WEAKENED",
        `查询套件必须保持 ${contract.querySuite}，当前为 ${facts.querySuite || "(未设置)"}`,
      ),
    );
  }
  if (facts.category !== contract.category) {
    issues.push(
      workflowIssue(
        contract,
        "CODEQL_CATEGORY_DRIFT",
        `SARIF category 必须保持 ${contract.category}，当前为 ${facts.category || "(未设置)"}（会让历史告警状态失联）`,
      ),
    );
  }
  if (!facts.hasSecurityEventsWrite) {
    issues.push(
      workflowIssue(
        contract,
        "CODEQL_PERMISSION_MISSING",
        "analyze 必须保留 security-events: write",
      ),
    );
  }
  if (facts.uploadDisabled) {
    issues.push(
      workflowIssue(
        contract,
        "CODEQL_UPLOAD_DISABLED",
        "禁止 upload: false，结果必须上传到 code scanning",
      ),
    );
  }
  if (!facts.analyzeJob?.hasTimeout) {
    issues.push(
      workflowIssue(contract, "CODEQL_TIMEOUT_MISSING", "analyze 作业必须设置 timeout-minutes"),
    );
  }
}

/** 路径前缀是否覆盖 `prefix`（`src/**` 与 `src` 等价，`src/lib` 也算覆盖）。 */
export function pathCovers(entry: string, prefix: string): boolean {
  const cleaned = stripQuotes(entry)
    .replace(/\/\*+$/, "")
    .replace(/\/+$/, "");
  return cleaned === prefix || cleaned.startsWith(`${prefix}/`);
}

function auditWorkflowScope(
  facts: CodeqlWorkflowFacts,
  contract: CodeqlContract,
  issues: CodeqlIssue[],
): void {
  for (const entry of facts.pathIgnores) {
    if (contract.allowedIgnoredPaths.includes(entry)) continue;
    issues.push(
      workflowIssue(
        contract,
        "CODEQL_PATH_IGNORE_UNREGISTERED",
        `paths-ignore 里的 ${entry} 未登记在契约中；排除源码会让告警零回归失去意义`,
      ),
    );
  }
  if (facts.pathIncludes.length === 0) return;
  for (const prefix of contract.sourcePrefixes) {
    if (facts.pathIncludes.some((entry) => pathCovers(entry, prefix))) continue;
    issues.push(
      workflowIssue(
        contract,
        "CODEQL_PATHS_MISSING_SOURCE",
        `paths 白名单漏掉了源码前缀 ${prefix}`,
      ),
    );
  }
}

function auditWorkflowTriggers(
  facts: CodeqlWorkflowFacts,
  contract: CodeqlContract,
  issues: CodeqlIssue[],
): void {
  if (!facts.triggers.includes("push")) {
    issues.push(workflowIssue(contract, "CODEQL_BRANCH_COVERAGE_DRIFT", "必须保留 push 触发"));
  } else {
    for (const branch of contract.pushBranches) {
      if (facts.pushBranches.includes(branch)) continue;
      issues.push(
        workflowIssue(contract, "CODEQL_BRANCH_COVERAGE_DRIFT", `push 必须覆盖分支 ${branch}`),
      );
    }
  }
  if (!facts.triggers.includes("pull_request")) {
    issues.push(
      workflowIssue(contract, "CODEQL_BRANCH_COVERAGE_DRIFT", "必须保留 pull_request 触发"),
    );
  } else {
    for (const branch of contract.pullRequestBranches) {
      if (facts.pullRequestBranches.includes(branch)) continue;
      issues.push(
        workflowIssue(
          contract,
          "CODEQL_BRANCH_COVERAGE_DRIFT",
          `pull_request 必须覆盖分支 ${branch}`,
        ),
      );
    }
  }
  if (!facts.triggers.includes("schedule")) {
    issues.push(
      workflowIssue(
        contract,
        "CODEQL_SCHEDULE_MISSING",
        "必须保留 schedule 触发，定期扫描新披露规则",
      ),
    );
    return;
  }
  if (!facts.crons.some((cron) => isWeeklyCron(cron, contract.scheduleWeekday))) {
    issues.push(
      workflowIssue(
        contract,
        "CODEQL_SCHEDULE_CADENCE_DRIFT",
        `schedule 必须包含每周星期 ${contract.scheduleWeekday} 的一次扫描，当前为 [${facts.crons.join(", ")}]`,
      ),
    );
  }
}

function auditTriageDoc(
  doc: TextFile | undefined,
  contract: CodeqlContract,
  issues: CodeqlIssue[],
): void {
  if (!doc) {
    issues.push({
      code: "CODEQL_TRIAGE_DOC_MISSING",
      path: contract.triageDocPath,
      detail: `${contract.triageDocPath} 缺失，告警处置流程没有单一事实来源`,
    });
    return;
  }
  if (doc.content.trim().length === 0) {
    issues.push({
      code: "CODEQL_TRIAGE_DOC_MISSING",
      path: doc.path,
      detail: "告警处置 runbook 为空，抽取结果视为失败",
    });
    return;
  }
  for (const section of contract.triageDocSections) {
    if (doc.content.includes(section)) continue;
    issues.push({
      code: "CODEQL_TRIAGE_SECTION_MISSING",
      path: doc.path,
      detail: `缺少必备章节「${section}」`,
    });
  }
  const facts: Array<[string, string]> = [
    [contract.querySuite, `查询套件 ${contract.querySuite}`],
    [String(contract.blockingSecuritySeverity), `阻断严重度 ${contract.blockingSecuritySeverity}`],
    [`${contract.triageSlaDays} 个工作日`, `分诊 SLA ${contract.triageSlaDays} 个工作日`],
    ...contract.dismissalReasons.map(
      (reason) => [reason, `允许的 dismissal 理由 ${reason}`] as [string, string],
    ),
  ];
  for (const [token, label] of facts) {
    if (doc.content.includes(token)) continue;
    issues.push({
      code: "CODEQL_TRIAGE_FACT_MISSING",
      path: doc.path,
      detail: `runbook 缺少事实：${label}`,
    });
  }
}

/** 审计 CodeQL 扫描强度与告警处置策略；纯函数，不读取文件系统。 */
export function auditCodeqlAlertPolicy(input: CodeqlPolicyInput): CodeqlPolicyReport {
  const contract = input.contract ?? CODEQL_CONTRACT;
  const issues: CodeqlIssue[] = [];
  const workflow = input.workflow;

  if (!workflow || workflow.content.trim().length === 0) {
    issues.push({
      code: workflow ? "CODEQL_SOURCE_EMPTY" : "CODEQL_WORKFLOW_MISSING",
      path: workflow?.path ?? contract.path,
      detail: `${contract.path} 缺失或为空，扫描强度无法确认`,
    });
  } else {
    const facts = parseCodeqlWorkflow(workflow.content, contract);
    auditWorkflowIdentity(facts, contract, issues);
    auditWorkflowAnalysis(facts, contract, issues);
    auditWorkflowScope(facts, contract, issues);
    auditWorkflowTriggers(facts, contract, issues);
  }
  auditTriageDoc(input.triageDoc, contract, issues);

  const checks =
    contract.languages.length +
    contract.pushBranches.length +
    contract.pullRequestBranches.length +
    contract.triageDocSections.length +
    contract.dismissalReasons.length +
    8;
  return { issues, checks };
}

/** 输出格式：带规则码，CLI 与单测共用。 */
export function formatCodeqlIssues(issues: readonly CodeqlIssue[]): string {
  return issues.map((item) => `❌ [${item.code}] ${item.path} ${item.detail}`).join("\n");
}
