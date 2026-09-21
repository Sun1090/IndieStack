import path from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Production Smoke 工作流契约检查实现。
 *
 * 规则本体在 src/lib/deployment/production-smoke-contract.ts；这里只负责读取工作流
 * 与输出带规则码的报告。
 */
import { readWorkflows } from "./workflow-policy-check.js";
import {
  auditProductionSmokeWorkflow,
  formatSmokeWorkflowIssues,
} from "../../src/lib/deployment/production-smoke-contract.ts";

export function runProductionSmokeContractCheck() {
  let workflows;
  try {
    workflows = readWorkflows();
  } catch (error) {
    console.error(`❌ 无法读取工作流快照：${error.message}`);
    return 1;
  }

  const report = auditProductionSmokeWorkflow(workflows);
  if (report.issues.length > 0) {
    console.error(`❌ Production Smoke 工作流契约校验失败（${report.issues.length} 项）`);
    console.error(formatSmokeWorkflowIssues(report.issues));
    return 1;
  }

  console.log(`✅ Production Smoke 工作流契约校验通过：${report.workflows} 个工作流`);
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runProductionSmokeContractCheck();
