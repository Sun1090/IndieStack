import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkflows } from "../../../scripts/lib/workflow-policy-check.js";
import {
  auditProductionSmokeWorkflow,
  formatSmokeWorkflowIssues,
  PRODUCTION_SMOKE_CONTRACT,
} from "./production-smoke-contract";

const REPO_ROOT = process.cwd();
const SAMPLE_WORKFLOW = [
  "name: Production Smoke",
  "",
  "on:",
  "  workflow_dispatch:",
  "  schedule:",
  `    - cron: "${PRODUCTION_SMOKE_CONTRACT.scheduledCron}"`,
  "",
  "jobs:",
  "  smoke:",
  "    name: Side-effect-free production smoke",
  "    if: github.event_name == 'workflow_dispatch'",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 5",
  "    env:",
  "      SMOKE_URL: ${{ inputs.url }}",
  "      TIMEOUT_MS: ${{ inputs.timeout_ms }}",
  "    steps:",
  '      - run: pnpm smoke:production -- "$SMOKE_URL" --timeout-ms "$TIMEOUT_MS"',
  "      - name: Upload smoke evidence",
  "        uses: actions/upload-artifact@v7",
  "        if: always()",
  "        with:",
  `          name: ${PRODUCTION_SMOKE_CONTRACT.manualArtifact}`,
  "          path: production-smoke.json",
  "          retention-days: 30",
  "  smoke-main:",
  "    name: Daily production version drift check",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 5",
  "    steps:",
  `      - run: node scripts/check-production-version.js --base-url ${PRODUCTION_SMOKE_CONTRACT.defaultUrl}`,
  "      - name: Upload drift evidence",
  "        uses: actions/upload-artifact@v7",
  "        if: always()",
  "        with:",
  `          name: ${PRODUCTION_SMOKE_CONTRACT.scheduledArtifact}`,
  "          path: production-smoke.json",
  "          retention-days: 30",
].join("\n");

const MANUAL_GUARD = "    if: github.event_name == 'workflow_dispatch'\n";
const MANUAL_UPLOAD_NAME = `          name: ${PRODUCTION_SMOKE_CONTRACT.manualArtifact}\n`;
const SCHEDULED_UPLOAD_NAME = `          name: ${PRODUCTION_SMOKE_CONTRACT.scheduledArtifact}\n`;

function audit(workflows = [{ path: PRODUCTION_SMOKE_CONTRACT.path, content: SAMPLE_WORKFLOW }]) {
  return auditProductionSmokeWorkflow(workflows);
}

function issuesOf(workflow: string): string {
  return formatSmokeWorkflowIssues(audit([{ path: PRODUCTION_SMOKE_CONTRACT.path, content: workflow }]).issues);
}

function issue(workflow: string, changes: { from: string | RegExp; to: string }): string {
  return issuesOf(workflow.replace(changes.from, changes.to));
}

describe("auditProductionSmokeWorkflow", () => {
  it("accepts a workflow that keeps release smoke and deployment drift checks on the same evidence contract", () => {
    expect(audit().issues).toEqual([]);
  });

  it("fails closed when the workflow is missing", () => {
    const report = auditProductionSmokeWorkflow([{ path: ".github/workflows/ci.yml", content: "name: CI" }]);
    expect(report.issues[0]).toMatchObject({ code: "SMOKE_WORKFLOW_MISSING" });
  });

  it("requires the audited Production Smoke name, dispatch trigger, and scheduled cron", () => {
    expect(issue(SAMPLE_WORKFLOW, { from: "name: Production Smoke", to: "name: Deploy Smoke" })).toContain(
      "SMOKE_WORKFLOW_NAME_DRIFT",
    );
    expect(issue(SAMPLE_WORKFLOW, { from: /on:[\s\S]*?schedule:\s*\n\s*- cron: ".*?"/, to: "on:\n  workflow_dispatch:" })).toContain(
      "SMOKE_SCHEDULE_DRIFT",
    );
  });

  it("requires both manual and scheduled smoke jobs to run checks and retain evidence", () => {
    const noManualRun = SAMPLE_WORKFLOW.replace('      - run: pnpm smoke:production -- "$SMOKE_URL" --timeout-ms "$TIMEOUT_MS"', "      - run: pnpm test");
    expect(issuesOf(noManualRun)).toContain("SMOKE_COMMAND_DRIFT");
    const noScheduledRun = SAMPLE_WORKFLOW.replace(
      `      - run: node scripts/check-production-version.js --base-url ${PRODUCTION_SMOKE_CONTRACT.defaultUrl}`,
      "      - run: pnpm test",
    );
    expect(issuesOf(noScheduledRun)).toContain("SMOKE_VERSION_CHECK_DRIFT");
  });

  it("requires an inputs-driven manual job to exclude schedule triggers", () => {
    // 复刻真实缺陷：schedule 触发时 inputs 为空，手动作业连生产都不访问，
    // 却占据「定时 smoke 失败」的信号位。
    expect(issue(SAMPLE_WORKFLOW, { from: MANUAL_GUARD, to: "" })).toContain("SMOKE_MANUAL_TRIGGER_GUARD_MISSING");
    expect(
      issue(SAMPLE_WORKFLOW, {
        from: "    if: github.event_name == 'workflow_dispatch'",
        to: "    if: github.event_name == 'schedule'",
      }),
    ).toContain("SMOKE_MANUAL_TRIGGER_GUARD_MISSING");
    // 不读 inputs 的作业不需要守卫，不得凭空报错（参数写死在命令里，定时触发也能跑）。
    const withoutInputs = SAMPLE_WORKFLOW.replace(
      '      - run: pnpm smoke:production -- "$SMOKE_URL" --timeout-ms "$TIMEOUT_MS"',
      "      - run: pnpm smoke:production https://example.com",
    ).replace("    env:\n      SMOKE_URL: ${{ inputs.url }}\n      TIMEOUT_MS: ${{ inputs.timeout_ms }}\n", "");
    expect(issuesOf(withoutInputs.replace(MANUAL_GUARD, ""))).toBe("");
  });

  it("pins each job to its own evidence artifact name", () => {
    expect(issue(SAMPLE_WORKFLOW, { from: MANUAL_UPLOAD_NAME, to: "" })).toContain("SMOKE_ARTIFACT_NAME_DRIFT");
    // 同名 artifact：一次 workflow_dispatch 会留下两份 production-smoke.json，
    // gh run download -n 只保留后落地的那一份，发布证据归属不确定。
    expect(
      issue(SAMPLE_WORKFLOW, { from: SCHEDULED_UPLOAD_NAME, to: MANUAL_UPLOAD_NAME }),
    ).toContain("SMOKE_ARTIFACT_NAME_DRIFT");
    expect(
      issue(SAMPLE_WORKFLOW, {
        from: SCHEDULED_UPLOAD_NAME,
        to: `          name: "${PRODUCTION_SMOKE_CONTRACT.scheduledArtifact}"\n`,
      }),
    ).toBe("");
  });

  it("keeps the tracked production smoke workflow on the contract", () => {
    const workflows = readWorkflows();
    const report = auditProductionSmokeWorkflow(workflows);
    expect(formatSmokeWorkflowIssues(report.issues)).toBe("");
    expect(report.workflows).toBe(workflows.length);
  });

  it("audits the real workflow's manual trigger guard and artifact names", () => {
    const content = fs.readFileSync(path.join(REPO_ROOT, PRODUCTION_SMOKE_CONTRACT.path), "utf8");
    expect(content).toMatch(/^ {4}if: github\.event_name == 'workflow_dispatch'$/m);
    expect(content).toContain(`name: ${PRODUCTION_SMOKE_CONTRACT.manualArtifact}`);
    expect(content).toContain(`name: ${PRODUCTION_SMOKE_CONTRACT.scheduledArtifact}`);
    expect(content.match(/name: production-smoke-evidence/g)).toHaveLength(1);
  });
});
