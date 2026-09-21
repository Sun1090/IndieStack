import { parseWorkflow, type ParsedWorkflow, type WorkflowDocument } from "../ci/workflow-policy.ts";

export interface SmokeWorkflowContract {
  path: string;
  name: string;
  manualJob: string;
  scheduledJob: string;
  scheduledCron: string;
  defaultUrl: string;
}

export const PRODUCTION_SMOKE_CONTRACT: SmokeWorkflowContract = {
  path: ".github/workflows/production-smoke.yml",
  name: "Production Smoke",
  manualJob: "smoke",
  scheduledJob: "smoke-main",
  scheduledCron: "17 2 * * *",
  defaultUrl: "https://indie-stack-theta.vercel.app",
};

export interface SmokeWorkflowIssue {
  code: string;
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

function issue(path: string, code: string, detail: string): SmokeWorkflowIssue {
  return { code, path, detail };
}

function hasUploadArtifact(body: string, retentionDays: number): boolean {
  return Boolean(
    /uses:\s*actions\/upload-artifact@v\d/.test(body) &&
      /\bpath:\s*production-smoke\.json\b/.test(body) &&
      new RegExp(`retention-days:\\s*${retentionDays}\\b`).test(body),
  );
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

function auditManualSmoke(parsed: ParsedWorkflow, contract: SmokeWorkflowContract, issues: SmokeWorkflowIssue[]): void {
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

