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
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 5",
  "    steps:",
  "      - run: pnpm smoke:production",
  "      - uses: actions/upload-artifact@v7",
  "        if: always()",
  "        with:",
  "          path: production-smoke.json",
  "          retention-days: 30",
  "  smoke-main:",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 5",
  "    steps:",
  `      - run: node scripts/check-production-version.js --base-url ${PRODUCTION_SMOKE_CONTRACT.defaultUrl}`,
  "      - uses: actions/upload-artifact@v7",
  "        if: always()",
  "        with:",
  "          path: production-smoke.json",
  "          retention-days: 30",
].join("\n");

function audit(workflows = [{ path: PRODUCTION_SMOKE_CONTRACT.path, content: SAMPLE_WORKFLOW }]) {
  return auditProductionSmokeWorkflow(workflows);
}

function issue(workflow: string, changes: { from: string | RegExp; to: string }): string {
  const updated = workflow.replace(changes.from, changes.to);
  return formatSmokeWorkflowIssues(audit([{ path: PRODUCTION_SMOKE_CONTRACT.path, content: updated }]).issues);
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
    const noManualRun = SAMPLE_WORKFLOW.replace("      - run: pnpm smoke:production", "      - run: pnpm test");
    expect(formatSmokeWorkflowIssues(audit([{ path: PRODUCTION_SMOKE_CONTRACT.path, content: noManualRun }]).issues)).toContain(
      "SMOKE_COMMAND_DRIFT",
    );
    const noScheduledRun = SAMPLE_WORKFLOW.replace(
      `      - run: node scripts/check-production-version.js --base-url ${PRODUCTION_SMOKE_CONTRACT.defaultUrl}`,
      "      - run: pnpm test",
    );
    expect(
      formatSmokeWorkflowIssues(audit([{ path: PRODUCTION_SMOKE_CONTRACT.path, content: noScheduledRun }]).issues),
    ).toContain("SMOKE_VERSION_CHECK_DRIFT");
  });

  it("keeps the tracked production smoke workflow on the contract", () => {
    const workflows = readWorkflows();
    const report = auditProductionSmokeWorkflow(workflows);
    expect(formatSmokeWorkflowIssues(report.issues)).toBe("");
    expect(report.workflows).toBe(workflows.length);
  });
});
