/**
 * CI 工作流拓扑与并行/缓存策略门禁（J03）。
 *
 * 背景：`pnpm check:gates` 只保证「门禁会跑」，但从不检查工作流本身的质量——一个
 * `uses: actions/checkout@main`、缺 `timeout-minutes` 的作业、指向不存在作业的 `needs`、
 * 在 PR 上并发跑同一分支却不取消旧运行、或者 `pnpm check:tpyo` 这种拼错的脚本名，
 * 都能悄悄进入仓库并在几分钟到几十分钟后才以「跑挂了但没人知道为什么」的形式暴露。
 *
 * 本模块把工作流卫生固化为可执行规则，全部为纯函数（不读文件系统）：
 *
 *   - 每个作业必须有 `runs-on` 与 `timeout-minutes`（防止卡死的运行占用 runner 配额）；
 *   - 每个 `uses:` 必须固定在 semver 标签或 40 位 SHA（禁止 `@main` / `@latest` 等漂移引用）；
 *   - `needs:` 必须指向同一工作流里真实存在的作业；
 *   - 触发 `pull_request` 的工作流必须声明 `concurrency` 且 `cancel-in-progress` 不为 `false`；
 *   - 禁止 `pull_request_target`（可写权限 + PR 代码的组合）；
 *   - 工作流里引用的 `pnpm <a:b>` 脚本必须真实存在于 `package.json`；
 *   - `ci.yml` 的并行/缓存拓扑必须匹配契约：静态门禁最快失败、单元测试独立并行、
 *     构建与 E2E 只等静态门禁、Playwright 浏览器缓存按锁文件哈希失效。
 *
 * 抽取结果为空时失败封闭，避免正则/解析失效被当成「零问题」。
 */

export interface WorkflowDocument {
  /** 仓库相对路径，仅用于报错定位。 */
  path: string;
  content: string;
}

export interface ParsedWorkflowJob {
  id: string;
  /** 作业级 `name:`，缺省回落到 id。 */
  name: string;
  /** 作业块正文（含缩进），用于拓扑断言。 */
  body: string;
  /** 作业头所在行（1 起算）。 */
  line: number;
  needs: string[];
  hasRunsOn: boolean;
  hasTimeout: boolean;
}

export interface ParsedWorkflow {
  path: string;
  /** 原始文件内容，用于扫描 `uses:` 与 `pnpm <script>` 引用。 */
  content: string;
  name: string;
  triggers: string[];
  jobs: ParsedWorkflowJob[];
  uses: string[];
  hasConcurrency: boolean;
  concurrencyBody: string;
}

export type WorkflowIssueCode =
  | "WORKFLOW_SOURCE_EMPTY"
  | "WORKFLOW_MISSING_JOBS"
  | "JOB_MISSING_RUNS_ON"
  | "JOB_MISSING_TIMEOUT"
  | "ACTION_UNPINNED"
  | "NEEDS_UNKNOWN_JOB"
  | "CONCURRENCY_MISSING"
  | "CONCURRENCY_NOT_CANCELLING"
  | "PULL_REQUEST_TARGET_FORBIDDEN"
  | "SCRIPT_UNKNOWN"
  | "HEALTHCHECK_URL_NOT_NORMALIZED"
  | "CI_TOPOLOGY_DRIFT";

export interface WorkflowIssue {
  code: WorkflowIssueCode;
  path: string;
  job?: string;
  detail: string;
}

export interface WorkflowPolicyInput {
  workflows: readonly WorkflowDocument[];
  /** `package.json` 的 scripts 注册表。 */
  scripts: Readonly<Record<string, string>>;
  /** 可注入的拓扑契约，便于单测构造反例。 */
  topology?: CiTopologyContract;
}

export interface WorkflowPolicyReport {
  issues: WorkflowIssue[];
  workflows: number;
  jobs: number;
  actions: number;
}

/** `ci.yml` 的并行与缓存契约——改动这里等于改动 CI 的墙钟时间与失败代价，需要评审。 */
export interface CiTopologyContract {
  path: string;
  /** 廉价静态门禁作业：最快失败，构建与 E2E 只等它。 */
  staticJob: string;
  /** 单元测试作业：与静态门禁并行，不阻塞构建与 E2E。 */
  unitTestJob: string;
  /** 昂贵作业：`needs` 必须恰好是静态门禁。 */
  expensiveJobs: readonly string[];
  /** Playwright 浏览器缓存目录。 */
  browserCachePath: string;
  /** 缓存键里用于失效的锁文件表达式。 */
  lockfileToken: string;
}

export const CI_TOPOLOGY: CiTopologyContract = {
  path: ".github/workflows/ci.yml",
  staticJob: "lint-and-type-check",
  unitTestJob: "unit-tests",
  expensiveJobs: ["build", "e2e"],
  browserCachePath: "~/.cache/ms-playwright",
  lockfileToken: "hashFiles('pnpm-lock.yaml')",
};

const JOB_HEADER = /^ {2}([A-Za-z0-9_-]+):\s*$/;
const JOB_KEY = /^ {4}([a-z-]+):\s*(.*)$/;
const USES_LINE = /^\s*(?:-\s*)?uses:\s*(\S+)\s*$/gm;
// 只承认同一行内的 `pnpm <script>`：`\s` 会跨行，把 `- name: Setup pnpm` 后面那行
// 的 `uses:` 当成脚本名校验，产生假阳性。
const PNPM_COMMAND = /pnpm[ \t]+([^\r\n]+)/g;
const PINNED_REF = /@(?:v\d+(?:\.\d+){0,2}|[0-9a-f]{40})$/;
const FORBIDDEN_REFS = new Set(["main", "master", "latest", "head", "develop"]);

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => stripQuotes(item))
    .filter((item) => item.length > 0);
}

/** 解析 `on:` 块，返回触发事件名（支持内联数组、单值与块形式）。 */
export function parseTriggers(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => /^on:(\s|$)/.test(line));
  if (start === -1) return [];
  const header = lines[start];
  const inlineList = /^on:\s*\[([^\]]*)\]/.exec(header);
  if (inlineList) return splitList(inlineList[1]);
  const single = /^on:\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(header);
  if (single) return [single[1]];

  const triggers: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    if (/^\S/.test(line)) break;
    const match = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):/.exec(line);
    if (match) triggers.push(match[1]);
  }
  return triggers;
}

/** 取 action 引用的版本部分（`owner/repo[/sub]@ref` → `ref`）；没有 `@` 时返回空串。 */
export function actionRefVersion(ref: string): string {
  const parts = ref.split("@");
  return parts.length === 2 ? parts[1].trim() : "";
}

/** 判断版本是否固定在期望 major（`v4` 或更细的 `v4.1.2`）。 */
export function isVersionAtMajor(version: string, major: string): boolean {
  return version === major || version.startsWith(`${major}.`);
}

/** 从作业正文里取某个 step 的 `uses:` 引用；同一个 action 出现多次时取最后一个。 */
export function parseStepRef(body: string, actionPath: string): string {
  const pattern = new RegExp(`uses:\\s*(${actionPath}@\\S+)`, "g");
  return [...body.matchAll(pattern)].at(-1)?.[1] ?? "";
}

/** 取 `on:` 块下某个触发器的子块正文（含缩进）；找不到时返回空字符串。 */
export function parseTriggerBlock(lines: readonly string[], trigger: string): string {
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

/** 解析形如 `key: [a, b]` 或 `key:` + `- a` 的列表值；找不到时返回空数组。 */
export function parseKeyedList(block: string, key: string): string[] {
  const lines = block.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = new RegExp(`^\\s*${key}:\\s*(.*)$`).exec(lines[index]);
    if (!match) continue;
    const inline = match[1].trim();
    if (inline.startsWith("[")) return splitList(inline.replace(/^\[|\]$/g, ""));
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

/** 读取触发器子块里的 `branches:`（支持内联数组与块列表）。 */
export function parseTriggerBranches(lines: readonly string[], trigger: string): string[] {
  const block = parseTriggerBlock(lines, trigger);
  if (block.length === 0) return [];
  return parseKeyedList(block, "branches");
}

function parseNeeds(bodyLines: readonly string[]): string[] {
  const needs: string[] = [];
  for (let index = 0; index < bodyLines.length; index += 1) {
    const match = JOB_KEY.exec(bodyLines[index]);
    if (!match || match[1] !== "needs") continue;
    const value = match[2].trim();
    if (value.startsWith("[")) {
      needs.push(...splitList(value.replace(/^\[|\]$/g, "")));
      continue;
    }
    if (value.length > 0) {
      needs.push(stripQuotes(value));
      continue;
    }
    for (let cursor = index + 1; cursor < bodyLines.length; cursor += 1) {
      const item = /^\s{6,}-\s*(.+?)\s*$/.exec(bodyLines[cursor]);
      if (!item) break;
      needs.push(stripQuotes(item[1]));
    }
  }
  return needs;
}

function toJob(id: string, line: number, bodyLines: readonly string[]): ParsedWorkflowJob {
  const nameMatch = /^ {4}name:\s*(.+?)\s*$/m.exec(bodyLines.join("\n"));
  return {
    id,
    name: nameMatch ? stripQuotes(nameMatch[1]) : id,
    body: bodyLines.join("\n"),
    line,
    needs: parseNeeds(bodyLines),
    hasRunsOn: /^ {4}runs-on:/m.test(bodyLines.join("\n")),
    hasTimeout: /^ {4}timeout-minutes:/m.test(bodyLines.join("\n")),
  };
}

/** 解析 `jobs:` 块，返回作业列表（按出现顺序）。 */
export function parseJobs(lines: readonly string[]): ParsedWorkflowJob[] {
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (start === -1) return [];
  const jobs: ParsedWorkflowJob[] = [];
  let current: { id: string; line: number; body: string[] } | null = null;

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length > 0 && /^\S/.test(line)) break;
    const header = JOB_HEADER.exec(line);
    if (header) {
      if (current) jobs.push(toJob(current.id, current.line, current.body));
      current = { id: header[1], line: index + 1, body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) jobs.push(toJob(current.id, current.line, current.body));
  return jobs;
}

function parseConcurrency(lines: readonly string[]): { declared: boolean; body: string } {
  const start = lines.findIndex((line) => /^concurrency:/.test(line));
  if (start === -1) return { declared: false, body: "" };
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    if (/^\S/.test(line)) break;
    body.push(line);
  }
  return { declared: true, body: body.join("\n") };
}

/** 解析单个工作流文档；纯文本缩进分析，不依赖 YAML 库。 */
export function parseWorkflow(document: WorkflowDocument): ParsedWorkflow {
  const lines = document.content.replace(/\r\n?/g, "\n").split("\n");
  const nameMatch = /^name:\s*(.+?)\s*$/m.exec(document.content);
  const jobs = parseJobs(lines);
  const concurrency = parseConcurrency(lines);
  return {
    path: document.path,
    content: document.content,
    name: nameMatch ? stripQuotes(nameMatch[1]) : "",
    triggers: parseTriggers(lines),
    jobs,
    uses: [...document.content.matchAll(USES_LINE)].map((match) => match[1]),
    hasConcurrency: concurrency.declared,
    concurrencyBody: concurrency.body,
  };
}

/** 判断 `uses:` 引用是否已固定（semver 标签或 40 位 SHA；本地 action 除外）。 */
export function isPinnedAction(ref: string): boolean {
  if (ref.startsWith("./")) return true;
  const at = ref.lastIndexOf("@");
  if (at <= 0) return false;
  const version = ref.slice(at + 1);
  if (FORBIDDEN_REFS.has(version.toLowerCase())) return false;
  return PINNED_REF.test(ref);
}

function auditJobHygiene(workflow: ParsedWorkflow, issues: WorkflowIssue[]): void {
  const jobIds = new Set(workflow.jobs.map((job) => job.id));
  for (const job of workflow.jobs) {
    if (!job.hasRunsOn) {
      issues.push({
        code: "JOB_MISSING_RUNS_ON",
        path: workflow.path,
        job: job.id,
        detail: `作业 ${job.id} 缺少 runs-on`,
      });
    }
    if (!job.hasTimeout) {
      issues.push({
        code: "JOB_MISSING_TIMEOUT",
        path: workflow.path,
        job: job.id,
        detail: `作业 ${job.id} 缺少 timeout-minutes，挂死会占满 runner 配额`,
      });
    }
    for (const need of job.needs) {
      if (!jobIds.has(need)) {
        issues.push({
          code: "NEEDS_UNKNOWN_JOB",
          path: workflow.path,
          job: job.id,
          detail: `作业 ${job.id} 的 needs 指向不存在的作业 ${need}`,
        });
      }
    }
  }
}

function auditConcurrency(workflow: ParsedWorkflow, issues: WorkflowIssue[]): void {
  if (workflow.triggers.includes("pull_request_target")) {
    issues.push({
      code: "PULL_REQUEST_TARGET_FORBIDDEN",
      path: workflow.path,
      detail: "禁止使用 pull_request_target：可写权限与外部 PR 代码的组合",
    });
  }
  if (!workflow.triggers.includes("pull_request")) return;
  if (!workflow.hasConcurrency) {
    issues.push({
      code: "CONCURRENCY_MISSING",
      path: workflow.path,
      detail:
        "触发 pull_request 的工作流必须声明 concurrency，避免同分支旧运行与新运行同时占用 runner",
    });
    return;
  }
  const cancel = /cancel-in-progress:\s*(.+?)\s*$/.exec(workflow.concurrencyBody);
  if (!cancel || cancel[1].trim().toLowerCase() === "false") {
    issues.push({
      code: "CONCURRENCY_NOT_CANCELLING",
      path: workflow.path,
      detail: "concurrency 必须设置非 false 的 cancel-in-progress",
    });
  }
}

function auditScripts(
  workflow: ParsedWorkflow,
  scripts: Readonly<Record<string, string>>,
  issues: WorkflowIssue[],
): void {
  for (const match of workflow.content.matchAll(PNPM_COMMAND)) {
    const tokens = match[1].trim().split(/[ \t]+/);
    const script = tokens.find((token) => !token.startsWith("-"));
    if (!script?.includes(":")) continue;
    if (script in scripts) continue;
    issues.push({
      code: "SCRIPT_UNKNOWN",
      path: workflow.path,
      detail: `工作流引用了不存在的脚本 pnpm ${script}`,
    });
  }
}

function topologyDrift(job: string | undefined, detail: string): WorkflowIssue {
  return { code: "CI_TOPOLOGY_DRIFT", path: CI_TOPOLOGY.path, job, detail };
}

function auditEntryJobs(
  staticJob: ParsedWorkflowJob | undefined,
  unitJob: ParsedWorkflowJob | undefined,
  contract: CiTopologyContract,
  issues: WorkflowIssue[],
): void {
  if (!staticJob) {
    issues.push(topologyDrift(contract.staticJob, `缺少静态门禁作业 ${contract.staticJob}`));
  } else {
    if (staticJob.needs.length > 0) {
      issues.push(topologyDrift(staticJob.id, "静态门禁作业必须无前置依赖，才能最快失败"));
    }
    if (jobRuns(staticJob.body, "pnpm test:coverage")) {
      issues.push(
        topologyDrift(staticJob.id, "覆盖率测试应放在单元测试作业，避免阻塞构建与 E2E 的启动"),
      );
    }
  }

  if (!unitJob) {
    issues.push(topologyDrift(contract.unitTestJob, `缺少单元测试作业 ${contract.unitTestJob}`));
    return;
  }
  if (unitJob.needs.length > 0) {
    issues.push(topologyDrift(unitJob.id, "单元测试作业必须无前置依赖，才能与静态门禁并行"));
  }
  if (!jobRuns(unitJob.body, "pnpm test:coverage")) {
    issues.push(topologyDrift(unitJob.id, "单元测试作业必须运行 pnpm test:coverage"));
  }
}

function auditExpensiveJobs(
  byId: ReadonlyMap<string, ParsedWorkflowJob>,
  contract: CiTopologyContract,
  issues: WorkflowIssue[],
): void {
  for (const id of contract.expensiveJobs) {
    const job = byId.get(id);
    if (!job) {
      issues.push(topologyDrift(id, `缺少昂贵作业 ${id}`));
      continue;
    }
    if (job.needs.join(",") !== contract.staticJob) {
      issues.push(
        topologyDrift(
          id,
          `作业 ${id} 的 needs 必须恰好是 [${contract.staticJob}]，当前为 [${job.needs.join(", ")}]`,
        ),
      );
    }
  }
}

function auditBrowserCache(
  byId: ReadonlyMap<string, ParsedWorkflowJob>,
  contract: CiTopologyContract,
  issues: WorkflowIssue[],
): void {
  const e2eJob = byId.get("e2e");
  if (!e2eJob || hasBrowserCache(e2eJob.body, contract)) return;
  issues.push(
    topologyDrift(
      "e2e",
      `e2e 作业必须缓存 ${contract.browserCachePath}，缓存键包含 ${contract.lockfileToken} 并设置 restore-keys`,
    ),
  );
}

function auditCiTopology(
  parsed: readonly ParsedWorkflow[],
  contract: CiTopologyContract,
  issues: WorkflowIssue[],
): void {
  const workflow = parsed.find((item) => item.path === contract.path);
  if (!workflow) {
    issues.push(topologyDrift(undefined, `缺少 ${contract.path}，无法确认 CI 并行与缓存契约`));
    return;
  }
  const byId = new Map(workflow.jobs.map((job) => [job.id, job]));
  auditEntryJobs(byId.get(contract.staticJob), byId.get(contract.unitTestJob), contract, issues);
  auditExpensiveJobs(byId, contract, issues);
  auditBrowserCache(byId, contract, issues);
}

/**
 * 检查 HEALTHCHECK_URL 契约不会把站点根地址伪装成 health endpoint。
 *
 * 历史上手动 health workflow 曾因传入根 URL 而收到 HTML 200，严格 readiness
 * 校验只能把故障暴露出来，无法在运行前阻止配置错误。这里保证 workflow 仍从
 * 仓库变量/手动输入读取目标，并由共享的 check-health 解析器统一补全为 /api/health。
 */
function auditHealthCheckWorkflow(
  workflow: ParsedWorkflow,
  issues: WorkflowIssue[],
): void {
  if (workflow.path !== ".github/workflows/health-check.yml") return;
  const health = workflow.jobs.find((job) => job.id === "health");
  const envLine = /^\s*HEALTHCHECK_URL:\s*(.+)$/m.exec(workflow.content)?.[1]?.trim() ?? "";
  const hasConfigurableSource =
    envLine.includes("github.event.inputs.health_url") &&
    envLine.includes("vars.HEALTHCHECK_URL");
  const usesSharedNormalizer = jobRuns(
    health?.body ?? "",
    'node scripts/check-health.js "$HEALTHCHECK_URL"',
  );

  if (!hasConfigurableSource || !usesSharedNormalizer) {
    issues.push({
      code: "HEALTHCHECK_URL_NOT_NORMALIZED",
      path: workflow.path,
      job: health?.id,
      detail:
        "HEALTHCHECK_URL 必须支持手动输入/仓库变量，并由 scripts/check-health.js 解析为 /api/health",
    });
  }
}

/**
 * 逐行判断作业是否执行了某条命令：既支持 `- run: pnpm x` 内联写法，也支持
 * `run: |` 块标量。按行扫描而不是跨行正则，避免 `\s` 吞掉换行后把别的步骤误判进来。
 */
function jobRuns(body: string, command: string): boolean {
  const lines = body.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*-?\s*run:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const inline = match[1].trim();
    if (inline.length > 0 && !/^[|>]/.test(inline)) {
      if (inline.includes(command)) return true;
      continue;
    }
    const indent = lines[index].search(/\S/);
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim().length === 0) continue;
      if (line.search(/\S/) <= indent) break;
      if (line.includes(command)) return true;
    }
  }
  return false;
}

function hasBrowserCache(body: string, contract: CiTopologyContract): boolean {
  return (
    /uses:\s*actions\/cache@/.test(body) &&
    body.includes(contract.browserCachePath) &&
    body.includes(contract.lockfileToken) &&
    /restore-keys:/.test(body)
  );
}

function auditWorkflow(
  workflow: ParsedWorkflow,
  scripts: Readonly<Record<string, string>>,
  issues: WorkflowIssue[],
): void {
  if (workflow.content.trim().length === 0) {
    issues.push({ code: "WORKFLOW_SOURCE_EMPTY", path: workflow.path, detail: "工作流文件为空" });
    return;
  }
  if (workflow.jobs.length === 0) {
    issues.push({
      code: "WORKFLOW_MISSING_JOBS",
      path: workflow.path,
      detail: "未能抽出任何作业，解析规则可能已失效",
    });
  }
  for (const ref of workflow.uses) {
    if (isPinnedAction(ref)) continue;
    issues.push({
      code: "ACTION_UNPINNED",
      path: workflow.path,
      detail: `action 引用 ${ref} 未固定在 semver 标签或 40 位 SHA`,
    });
  }
  auditJobHygiene(workflow, issues);
  auditConcurrency(workflow, issues);
  auditScripts(workflow, scripts, issues);
  auditHealthCheckWorkflow(workflow, issues);
}

/** 审计全部工作流；纯函数，不读取文件系统。 */
export function auditWorkflowPolicy(input: WorkflowPolicyInput): WorkflowPolicyReport {
  const issues: WorkflowIssue[] = [];
  const contract = input.topology ?? CI_TOPOLOGY;
  let jobs = 0;
  let actions = 0;

  if (input.workflows.length === 0) {
    issues.push({
      code: "WORKFLOW_SOURCE_EMPTY",
      path: ".github/workflows",
      detail: "没有可审计的工作流文件",
    });
  }
  const parsed = input.workflows.map((workflow) => parseWorkflow(workflow));
  for (const workflow of parsed) {
    jobs += workflow.jobs.length;
    actions += workflow.uses.length;
    auditWorkflow(workflow, input.scripts, issues);
  }
  auditCiTopology(parsed, contract, issues);

  return { issues, workflows: parsed.length, jobs, actions };
}

/** 输出格式：带规则码，CLI 与单测共用。 */
export function formatWorkflowIssues(issues: readonly WorkflowIssue[]): string {
  return issues
    .map(
      (item) => `❌ [${item.code}] ${item.path}${item.job ? ` (${item.job})` : ""} ${item.detail}`,
    )
    .join("\n");
}
