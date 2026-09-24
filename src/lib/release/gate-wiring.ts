/**
 * 门禁接线审计（I06 / J01）。
 *
 * 背景：`package.json` 里每个 `check:*` 脚本都代表一条已承诺的约束，但「写了脚本」
 * 不等于「门禁会跑」。check-all.sh 与 CI 是两份独立的手工维护清单，新增门禁时只加
 * jq 脚本、只加本地聚合、或只在 CI 加一步，都会让门禁静默失效——仓库此前就有
 * `check:docs` 与 `check:agents` 只存在于本地聚合、CI 从未执行的实例。
 *
 * 本模块把「门禁必须在本地聚合与 CI 都接线」固化为可执行规则：
 *
 *   - 每个 `check:*` 门禁都必须出现在 check-all.sh 或 CI，否则必须登记豁免理由；
 *   - check-all.sh 引用的脚本必须真实存在（防止改名后留下死引用）；
 *   - 豁免必须仍然成立，理由过期的登记同样失败封闭；
 *   - `.github/RELEASE_CHECKLIST.md` 里逐字引用的工作流/作业名必须真实存在；
 *   - 检查清单的打标签命令版本必须与 `package.json` 一致。
 *
 * 规则只判断接线与引用是否成立，不判断门禁本身的强度。
 */

const GATE_PREFIX = "check:";
const AGGREGATE_GATE = "check:all";
const AGGREGATE_NAMES = ["check:all", "verify:all"] as const;

/** 免于在本地聚合或 CI 直接运行的门禁，理由必须写明替代覆盖方式。 */
export interface GateException {
  /** 免于 check-all.sh 聚合时填写的理由。 */
  local?: string;
  /** 免于 CI 直接执行时填写的理由。 */
  ci?: string;
}

export const GATE_EXCEPTIONS: Readonly<Record<string, GateException>> = {
  "check:migration-history": {
    local: "需要 supabase start 或已链接项目，离线聚合不可用；静态部分由 check:migrations 覆盖",
    ci: "CI 不提供本地 Supabase 实例；迁移静态校验由 check:migrations 覆盖",
  },
  "check:bundle": {
    local: "需要完整生产构建产物，check:all 刻意不触发构建；由 pnpm verify:build 覆盖",
  },
  "check:perf": {
    local: "需要 .next 构建产物，check:all 不触发构建；由 pnpm verify 覆盖",
  },
};

export interface WorkflowDocument {
  path: string;
  content: string;
}

export interface WorkflowSummary {
  path: string;
  name: string;
  jobs: string[];
}

export interface GateWiringInput {
  /** package.json 的 scripts 字段。 */
  scripts: Readonly<Record<string, string>>;
  /** scripts/check-all.sh 内容。 */
  checkAll: string;
  workflows: readonly WorkflowDocument[];
  /** .github/RELEASE_CHECKLIST.md 内容。 */
  releaseChecklist: string;
  /** package.json 的 version，用于核对打标签命令。 */
  version: string;
  /** 可注入的豁免表，便于单测覆盖过期/空理由分支。 */
  exceptions?: Readonly<Record<string, GateException>>;
}

export interface GateIssue {
  code: string;
  subject: string;
  message: string;
}

export interface GateWiringReport {
  issues: GateIssue[];
  gates: string[];
  localGates: string[];
  ciGates: string[];
  exempted: string[];
  referencedScripts: string[];
  workflows: WorkflowSummary[];
  checklistWorkflows: string[];
}

function issue(code: string, subject: string, message: string): GateIssue {
  return { code, subject, message };
}

/** 以词边界匹配命令，避免 `pnpm check:migrations` 命中 `check:migrations-extra`。 */
function containsCommand(haystack: string, command: string): boolean {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?![\\w:-])`).test(haystack);
}

/** 匹配 `pnpm <name>` 与 `pnpm --silent <name>`，同样带词边界。 */
function containsPnpmScript(haystack: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`pnpm\\s+(?:--?[a-zA-Z-]+\\s+)*${escaped}(?![\\w:-])`).test(haystack);
}

/**
 * 门禁是否在某段文本里被执行：接受 `pnpm <gate>`、其原始命令，
 * 或直接调用该门禁的实现脚本（`node scripts/x.js`）。
 *
 * 第三种形态是给「产物已经就绪、只需跑断言」的 CI 用的：Build job 在 `pnpm build` 之后
 * 直接跑 `node scripts/check-bundle.js`，复用同一份产物，不必绕一遍聚合命令。只认脚本路径
 * 而不是任意文本，避免注释里提一句就算接线。
 */
function wiredInScriptList(text: string, gate: string, command: string): boolean {
  if (containsPnpmScript(text, gate)) return true;
  const raw = command.trim();
  if (raw.length > 0 && containsCommand(text, raw)) return true;
  return implementationScripts(raw).some((script) => text.includes(script));
}

/** 从门禁命令里取出实现脚本路径（形如 `scripts/foo.js`），用于识别 CI 的直接脚本调用。 */
export function implementationScripts(command: string): string[] {
  return [...command.matchAll(/scripts\/[\w./-]+\.js/g)].map((match) => match[0]).sort();
}

/** 列出所有 `check:*` 门禁脚本（`check:all` 是聚合入口，本身不是门禁）。 */
export function listGates(scripts: Readonly<Record<string, string>>): string[] {
  return Object.keys(scripts)
    .filter((name) => name.startsWith(GATE_PREFIX) && name !== AGGREGATE_GATE)
    .sort();
}

/** 解析 check-all.sh 里 `pnpm --silent <script>` / `pnpm <script>` 形式的调用。 */
export function parseAggregateReferences(checkAll: string): string[] {
  const names = new Set<string>();
  for (const match of checkAll.matchAll(/\bpnpm\s+(?:--silent\s+)?([a-z][a-z0-9:._-]*)/g)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

/** 提取工作流名字与作业名，作为检查清单可以引用的合法名字集合。 */
export function parseWorkflows(workflows: readonly WorkflowDocument[]): {
  summaries: WorkflowSummary[];
  names: string[];
} {
  const summaries: WorkflowSummary[] = [];
  const names = new Set<string>();
  for (const workflow of workflows) {
    const nameMatch = /^name:\s*(.+?)\s*$/m.exec(workflow.content);
    const name = nameMatch ? stripQuotes(nameMatch[1]) : "";
    const jobs = [...workflow.content.matchAll(/^ {4}name:\s*(.+?)\s*$/gm)].map((match) =>
      stripQuotes(match[1]),
    );
    if (name) names.add(name);
    for (const job of jobs) names.add(job);
    summaries.push({ path: workflow.path, name, jobs });
  }
  summaries.sort((left, right) => left.path.localeCompare(right.path));
  return { summaries, names: [...names].sort() };
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function section(markdown: string, heading: string): string {
  // `(?! [\s\S])` 等价于 JS 缺失的 \Z：章节位于文末时也能取到正文。
  const pattern = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m");
  const match = pattern.exec(markdown);
  return match ? match[1] : "";
}

/** 提取检查清单中逐字引用的工作流/作业名（反引号包裹且以大写字母开头的名字）。 */
export function parseChecklistWorkflowReferences(checklist: string): string[] {
  const body = section(checklist, "门禁");
  const names = new Set<string>();
  for (const match of body.matchAll(/`([^`]+)`/g)) {
    const token = match[1].trim();
    if (/^[A-Z][A-Za-z0-9 &()'-]*$/.test(token)) names.add(token);
  }
  return [...names].sort();
}

/** 读取检查清单「打标签」章节里出现的所有 `vX.Y.Z` 版本号。 */
export function parseChecklistTagVersions(checklist: string): string[] {
  const body = section(checklist, "打标签");
  const versions = new Set<string>();
  for (const match of body.matchAll(/\bv(\d+\.\d+\.\d+)\b/g)) {
    versions.add(match[1]);
  }
  return [...versions].sort();
}

function auditGateTargets(
  gates: readonly string[],
  scripts: Readonly<Record<string, string>>,
  checkAll: string,
  workflows: readonly WorkflowDocument[],
  exceptions: Readonly<Record<string, GateException>>,
  issues: GateIssue[],
): { localGates: string[]; ciGates: string[]; exempted: string[] } {
  const localGates: string[] = [];
  const ciGates: string[] = [];
  const exempted: string[] = [];
  const aggregateInCi = workflows.some((workflow) =>
    AGGREGATE_NAMES.some((name) => containsPnpmScript(workflow.content, name)),
  );

  for (const gate of gates) {
    const exemption = exceptions[gate];
    const wiredLocally = containsPnpmScript(checkAll, gate);
    const wiredInCi =
      (aggregateInCi && wiredLocally) ||
      workflows.some((workflow) => wiredInScriptList(workflow.content, gate, scripts[gate] ?? ""));
    if (wiredLocally) localGates.push(gate);
    if (wiredInCi) ciGates.push(gate);
    if (wiredLocally && wiredInCi) continue;
    if (exemption) exempted.push(gate);
    if (!wiredLocally && !exemption?.local) {
      issues.push(
        issue(
          "GATE_UNWIRED_LOCAL",
          gate,
          `${gate} 未接入 scripts/check-all.sh；补齐聚合步骤或登记豁免理由`,
        ),
      );
    }
    if (!wiredInCi && !exemption?.ci) {
      issues.push(
        issue(
          "GATE_UNWIRED_CI",
          gate,
          `${gate} 未在任何 GitHub workflow 中执行；补 CI 步骤或登记豁免理由`,
        ),
      );
    }
  }
  return { localGates, ciGates, exempted };
}

function auditAggregateReferences(
  referenced: readonly string[],
  scripts: Readonly<Record<string, string>>,
  exceptions: Readonly<Record<string, GateException>>,
  issues: GateIssue[],
): void {
  for (const name of referenced) {
    if (!(name in scripts)) {
      issues.push(
        issue("AGGREGATE_UNKNOWN_SCRIPT", name, `check-all.sh 调用了不存在的脚本 ${name}`),
      );
      continue;
    }
    if (!name.startsWith(GATE_PREFIX) || name === AGGREGATE_GATE) continue;
    if (exceptions[name]?.local) {
      issues.push(
        issue("EXCEPTION_STALE", name, `${name} 已登记免于本地聚合，但 check-all.sh 仍在执行它`),
      );
    }
  }
}

function auditExceptions(
  scripts: Readonly<Record<string, string>>,
  localGates: readonly string[],
  ciGates: readonly string[],
  exceptions: Readonly<Record<string, GateException>>,
  issues: GateIssue[],
): void {
  for (const [gate, exemption] of Object.entries(exceptions)) {
    if (!(gate in scripts)) {
      issues.push(issue("EXCEPTION_STALE", gate, `豁免表登记了不存在的门禁 ${gate}，请删除该条目`));
      continue;
    }
    if (!exemption.local && !exemption.ci) {
      issues.push(issue("EXCEPTION_EMPTY", gate, `${gate} 的豁免条目必须写明理由`));
      continue;
    }
    if (exemption.local && localGates.includes(gate)) {
      issues.push(
        issue("EXCEPTION_STALE", gate, `${gate} 已接入 check-all.sh，但豁免表仍声明免于本地聚合`),
      );
    }
    if (exemption.ci && ciGates.includes(gate)) {
      issues.push(issue("EXCEPTION_STALE", gate, `${gate} 已在 CI 执行，但豁免表仍声明免于 CI`));
    }
  }
}

function auditChecklist(
  checklist: string,
  knownNames: readonly string[],
  version: string,
  issues: GateIssue[],
): string[] {
  const referenced = parseChecklistWorkflowReferences(checklist);
  for (const name of referenced) {
    if (!knownNames.includes(name)) {
      issues.push(
        issue(
          "CHECKLIST_WORKFLOW_UNKNOWN",
          name,
          `.github/RELEASE_CHECKLIST.md 引用的 “${name}” 不是任何 workflow 或 job 名称`,
        ),
      );
    }
  }

  const versions = parseChecklistTagVersions(checklist);
  if (versions.length === 0) {
    issues.push(
      issue(
        "CHECKLIST_TAG_VERSION",
        version,
        "RELEASE_CHECKLIST 的「打标签」章节缺少 git tag vX.Y.Z 命令",
      ),
    );
  } else if (versions.length > 1 || versions[0] !== version) {
    issues.push(
      issue(
        "CHECKLIST_TAG_VERSION",
        version,
        `RELEASE_CHECKLIST 打标签版本 ${versions.join(" / ")} 与 package.json ${version} 不一致`,
      ),
    );
  }
  return referenced;
}

/** 审计门禁接线、聚合引用、豁免登记与发布检查清单；纯函数，不读取文件系统。 */
export function auditGateWiring(input: GateWiringInput): GateWiringReport {
  const exceptions = input.exceptions ?? GATE_EXCEPTIONS;
  const gates = listGates(input.scripts);
  const referencedScripts = parseAggregateReferences(input.checkAll);
  const { summaries, names } = parseWorkflows(input.workflows);
  const issues: GateIssue[] = [];

  const { localGates, ciGates, exempted } = auditGateTargets(
    gates,
    input.scripts,
    input.checkAll,
    input.workflows,
    exceptions,
    issues,
  );
  auditAggregateReferences(referencedScripts, input.scripts, exceptions, issues);
  auditExceptions(input.scripts, localGates, ciGates, exceptions, issues);
  const checklistWorkflows = auditChecklist(input.releaseChecklist, names, input.version, issues);

  return {
    issues,
    gates,
    localGates,
    ciGates,
    exempted,
    referencedScripts,
    workflows: summaries,
    checklistWorkflows,
  };
}

/** 格式化为带规则码的文本，供 CLI 和测试复用。 */
export function formatGateIssues(issues: readonly GateIssue[]): string {
  return issues.map((item) => `❌ [${item.code}] ${item.subject} ${item.message}`).join("\n");
}
