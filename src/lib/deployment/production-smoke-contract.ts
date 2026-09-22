/**
 * `Production Smoke` workflow 契约（J06 / B01 的证据链）。
 *
 * 这个 workflow 同时承担两件事：发布负责人手动触发的一次完整无副作用 smoke，以及每天
 * 定时比对「生产版本 vs `package.json`」的漂移检查。两者都必须留下 30 天的证据文件，
 * 否则退出标准里的「artifact 指纹」就无从填写。
 *
 * 触发守卫来自一条真实缺陷：`on:` 里的 `schedule` 作用于**所有**作业，而手动作业把生产
 * URL 与超时写成了 `inputs.*` —— schedule 触发时 `inputs` 是空的，于是它每天在
 * `Error: --timeout-ms requires a value` 上失败（2026-09-21 与 09-22 的两次定时运行都是
 * 这个原因）。作业看起来在跑，实际连生产都没碰到；读日志的人会把它误当成「版本漂移告警」，
 * 而真正在报告漂移的是另一个作业。因此：手动作业读取 `inputs.` 时，必须用作业级
 * `if: github.event_name == 'workflow_dispatch'` 把自己限制在能提供这些输入的触发上。
 *
 * 同理，两个作业若把证据上传成同一个 artifact 名，一次运行会留下两份 `production-smoke.json`，
 * 而 `gh run download -n <name>` 实测只保留后落地的那一份且不报错 ——
 * 发布记录里的「artifact 指纹」于是无法确定属于哪一轮。artifact 名也是契约的一部分。
 */
import { parseWorkflow, type ParsedWorkflow, type WorkflowDocument } from "../ci/workflow-policy.ts";

export interface SmokeWorkflowContract {
  path: string;
  name: string;
  manualJob: string;
  scheduledJob: string;
  scheduledCron: string;
  defaultUrl: string;
  manualArtifact: string;
  scheduledArtifact: string;
}

export const PRODUCTION_SMOKE_CONTRACT: SmokeWorkflowContract = {
  path: ".github/workflows/production-smoke.yml",
  name: "Production Smoke",
  manualJob: "smoke",
  scheduledJob: "smoke-main",
  scheduledCron: "17 2 * * *",
  defaultUrl: "https://indie-stack-theta.vercel.app",
  manualArtifact: "production-smoke-evidence",
  scheduledArtifact: "production-version-drift-evidence",
};

export interface SmokeWorkflowIssue {
  code:
    | "SMOKE_WORKFLOW_MISSING"
    | "SMOKE_WORKFLOW_NAME_DRIFT"
    | "SMOKE_MANUAL_TRIGGER_MISSING"
    | "SMOKE_MANUAL_JOB_MISSING"
    | "SMOKE_COMMAND_DRIFT"
    | "SMOKE_ARTIFACT_DRIFT"
    | "SMOKE_ARTIFACT_NAME_DRIFT"
    | "SMOKE_MANUAL_TRIGGER_GUARD_MISSING"
    | "SMOKE_SCHEDULE_DRIFT"
    | "SMOKE_SCHEDULED_JOB_MISSING"
    | "SMOKE_SCHEDULED_DEP_DRIFT"
    | "SMOKE_DEFAULT_URL_DRIFT"
    | "SMOKE_VERSION_CHECK_DRIFT"
    | "SMOKE_SCHEDULED_ARTIFACT_DRIFT";
  path: string;
  detail: string;
}

export interface SmokeWorkflowReport {
  issues: SmokeWorkflowIssue[];
  workflows: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function issue(
  path: string,
  code: SmokeWorkflowIssue["code"],
  detail: string,
): SmokeWorkflowIssue {
  return { code, path, detail };
}

function hasUploadArtifact(body: string, retentionDays: number): boolean {
  return Boolean(
    /uses:\s*actions\/upload-artifact@v\d/.test(body) &&
      /\bpath:\s*production-smoke\.json\b/.test(body) &&
      new RegExp(`retention-days:\\s*${retentionDays}\\b`).test(body),
  );
}

/**
 * `upload-artifact` 步骤里显式声明的 artifact 名。
 *
 * 只在 `uses:` → `with:` → 更深缩进的键里找：步骤自己的 `- name: Upload smoke evidence`
 * 写在 `uses:` 之前，作业级 `name:` 缩进更浅，`if: always()` 是步骤级条件而非 `with:`
 * 的子键 —— 三者都不能被当成 artifact 名。
 */
function uploadArtifactName(body: string): string {
  const lines = body.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (!/uses:\s*actions\/upload-artifact@v\d/.test(lines[index])) continue;
    const stepIndent = lines[index].search(/\S/);
    let withIndent = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim().length === 0) continue;
      const indent = line.search(/\S/);
      // 下一个步骤（`- …`）或作业级键：本步骤结束。
      if (indent < stepIndent || (indent === stepIndent && /^\s*-/.test(line))) break;
      if (withIndent === -1) {
        if (indent === stepIndent && /^\s*with:\s*$/.test(line)) withIndent = indent;
        continue;
      }
      if (indent <= withIndent) break;
      const match = /^\s*name:\s*(\S+)\s*$/.exec(line);
      if (match) return stripQuotes(match[1]);
    }
  }
  return "";
}

/** 作业级 `if:`（4 空格缩进，即作业自己的键）的表达式；step 级 `if` 缩进更深，不算。 */
function jobLevelCondition(body: string): string {
  const match = /^ {4}if:\s*(.*)$/m.exec(body);
  return match ? match[1].trim() : "";
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

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

function auditManualSmoke(
  parsed: ParsedWorkflow,
  contract: SmokeWorkflowContract,
  issues: SmokeWorkflowIssue[],
): void {
  const manual = parsed.jobs.find((job) => job.id === contract.manualJob);
  if (!manual) {
    issues.push(issue(contract.path, "SMOKE_MANUAL_JOB_MISSING", `缺少手动作业 ${contract.manualJob}`));
    return;
  }
  if (!jobRuns(manual.body, "pnpm smoke:production")) {
    issues.push(issue(contract.path, "SMOKE_COMMAND_DRIFT", "手动生产 smoke 作业未运行 pnpm smoke:production"));
  }
  if (!hasUploadArtifact(manual.body, 30)) {
    issues.push(issue(contract.path, "SMOKE_ARTIFACT_DRIFT", "手动生产 smoke 作业未保留 production-smoke.json 30 天"));
  }
  if (uploadArtifactName(manual.body) !== contract.manualArtifact) {
    issues.push(
      issue(
        contract.path,
        "SMOKE_ARTIFACT_NAME_DRIFT",
        `手动作业的证据 artifact 名必须是 ${contract.manualArtifact}，实际为 ${uploadArtifactName(manual.body) || "（未声明）"}`,
      ),
    );
  }
  // schedule 触发时 inputs 全部为空：读取 inputs 的作业若不自限，每天会在参数解析上
  // 失败并从未触碰生产，却占据「定时 smoke 失败」这个信号位。
  const condition = jobLevelCondition(manual.body);
  if (/\binputs\./.test(manual.body) && !condition.includes("workflow_dispatch")) {
    issues.push(
      issue(
        contract.path,
        "SMOKE_MANUAL_TRIGGER_GUARD_MISSING",
        `手动作业读取 inputs.*，却没有把触发限制在 workflow_dispatch（作业级 if 当前为 ${condition || "（缺省）"}）；schedule 触发时它必然拿空参数失败`,
      ),
    );
  }
}

function auditScheduledSmoke(parsed: ParsedWorkflow, contract: SmokeWorkflowContract, issues: SmokeWorkflowIssue[]): void {
  const schedulePattern = new RegExp(`schedule:\\s*\\n\\s*- cron:\\s*["']${escapeRegExp(contract.scheduledCron)}["']`);
  if (!schedulePattern.test(parsed.content)) {
    issues.push(issue(contract.path, "SMOKE_SCHEDULE_DRIFT", `缺少定时触发 cron="${contract.scheduledCron}"`));
  }
  const scheduled = parsed.jobs.find((job) => job.id === contract.scheduledJob);
  if (!scheduled) {
    issues.push(issue(contract.path, "SMOKE_SCHEDULED_JOB_MISSING", `缺少定时作业 ${contract.scheduledJob}`));
    return;
  }
  if (scheduled.needs.length > 0) {
    issues.push(issue(contract.path, "SMOKE_SCHEDULED_DEP_DRIFT", "定时版本漂移检查必须无前置依赖"));
  }
  if (!scheduled.body.includes(contract.defaultUrl)) {
    issues.push(issue(contract.path, "SMOKE_DEFAULT_URL_DRIFT", `定时作业未固定默认生产 URL ${contract.defaultUrl}`));
  }
  if (!jobRuns(scheduled.body, "node scripts/check-production-version.js")) {
    issues.push(
      issue(contract.path, "SMOKE_VERSION_CHECK_DRIFT", "定时作业未运行 node scripts/check-production-version.js"),
    );
  }
  if (!hasUploadArtifact(scheduled.body, 30)) {
    issues.push(issue(contract.path, "SMOKE_SCHEDULED_ARTIFACT_DRIFT", "定时作业未保留 production-smoke.json 30 天"));
  }
  if (uploadArtifactName(scheduled.body) !== contract.scheduledArtifact) {
    issues.push(
      issue(
        contract.path,
        "SMOKE_ARTIFACT_NAME_DRIFT",
        `定时作业的证据 artifact 名必须是 ${contract.scheduledArtifact}，实际为 ${uploadArtifactName(scheduled.body) || "（未声明）"}`,
      ),
    );
  }
}

export function auditProductionSmokeWorkflow(
  workflows: readonly WorkflowDocument[],
  contract: SmokeWorkflowContract = PRODUCTION_SMOKE_CONTRACT,
): SmokeWorkflowReport {
  const issues: SmokeWorkflowIssue[] = [];
  const document = workflows.find((workflow) => workflow.path === contract.path);
  if (!document) {
    return {
      issues: [issue(contract.path, "SMOKE_WORKFLOW_MISSING", `缺少 ${contract.path}`)],
      workflows: workflows.length,
    };
  }

  const parsed = parseWorkflow(document);
  if (parsed.name !== contract.name) {
    issues.push(issue(contract.path, "SMOKE_WORKFLOW_NAME_DRIFT", `workflow 名称必须为 ${contract.name}`));
  }
  if (!parsed.triggers.includes("workflow_dispatch")) {
    issues.push(issue(contract.path, "SMOKE_MANUAL_TRIGGER_MISSING", "缺少 workflow_dispatch 发布后手动触发入口"));
  }

  auditManualSmoke(parsed, contract, issues);
  auditScheduledSmoke(parsed, contract, issues);
  return { issues, workflows: workflows.length };
}

export function formatSmokeWorkflowIssues(issues: readonly SmokeWorkflowIssue[]): string {
  return issues.map((item) => `❌ [${item.code}] ${item.path} ${item.detail}`).join("\n");
}

