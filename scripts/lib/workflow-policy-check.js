/**
 * CI 工作流拓扑与并行/缓存策略检查实现（J03）。
 *
 * 规则本体在 src/lib/ci/workflow-policy.ts（纯函数，由 vitest 覆盖）；这里负责读取
 * `.github/workflows/*.yml` 与 package.json scripts，并输出带规则码的报告。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditWorkflowPolicy, formatWorkflowIssues } from "../../src/lib/ci/workflow-policy.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const WORKFLOW_DIR = ".github/workflows";

/** 读取全部工作流文件（仓库相对路径 + 原始内容）。 */
export function readWorkflows(repoRoot = REPO_ROOT) {
  const directory = path.join(repoRoot, WORKFLOW_DIR);
  return fs
    .readdirSync(directory)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => ({
      path: `${WORKFLOW_DIR}/${name}`,
      content: fs.readFileSync(path.join(directory, name), "utf8"),
    }));
}

/** 读取 package.json 的 scripts 注册表。 */
export function readScripts(repoRoot = REPO_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  return pkg.scripts ?? {};
}

/** 组装工作流校验所需的全部输入，导出以便测试用临时目录验证 CLI。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  return { workflows: readWorkflows(repoRoot), scripts: readScripts(repoRoot) };
}

/** 返回进程退出码：0 表示拓扑与卫生规则全部满足，1 表示存在漂移或 IO 错误。 */
export function runWorkflowPolicyCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取工作流快照：${error.message}`);
    return 1;
  }

  const report = auditWorkflowPolicy(snapshot);
  if (report.issues.length > 0) {
    console.error(`❌ CI 工作流校验失败（${report.issues.length} 项）`);
    console.error(formatWorkflowIssues(report.issues));
    return 1;
  }
  console.log(
    `✅ CI 工作流校验通过：${report.workflows} 个工作流 / ${report.jobs} 个作业 / ${report.actions} 个 action 引用`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runWorkflowPolicyCheck(process.argv[2] ?? REPO_ROOT);
