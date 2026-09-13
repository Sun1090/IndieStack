/**
 * 门禁接线审计实现（I06 / J01）。
 *
 * 规则本体在 src/lib/release/gate-wiring.ts（纯函数，由 vitest 覆盖）；这里负责读取
 * package.json、scripts/check-all.sh、.github/workflows/*.yml 与发布检查清单。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditGateWiring, formatGateIssues } from "../../src/lib/release/gate-wiring.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CHECK_ALL_PATH = "scripts/check-all.sh";
export const WORKFLOW_DIR = ".github/workflows";
export const CHECKLIST_PATH = ".github/RELEASE_CHECKLIST.md";

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

/** 读取门禁接线审计所需的全部输入，导出以便测试用临时目录验证 CLI。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const workflowDir = path.join(repoRoot, WORKFLOW_DIR);
  const workflows = fs
    .readdirSync(workflowDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => ({
      path: toRepoPath(repoRoot, path.join(workflowDir, name)),
      content: fs.readFileSync(path.join(workflowDir, name), "utf8"),
    }));
  return {
    scripts: pkg.scripts ?? {},
    version: pkg.version ?? "",
    checkAll: fs.readFileSync(path.join(repoRoot, CHECK_ALL_PATH), "utf8"),
    workflows,
    releaseChecklist: fs.readFileSync(path.join(repoRoot, CHECKLIST_PATH), "utf8"),
  };
}

/** 返回进程退出码：0 表示门禁接线完整，1 表示存在阻断问题或 IO 错误。 */
export function runGateWiringCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取门禁接线快照：${error.message}`);
    return 1;
  }

  const report = auditGateWiring(snapshot);
  if (report.issues.length > 0) {
    console.error(`❌ 门禁接线审计失败（${report.issues.length} 项）`);
    console.error(formatGateIssues(report.issues));
    return 1;
  }
  console.log(
    `✅ 门禁接线审计通过：${report.gates.length} 个门禁（本地 ${report.localGates.length} / CI ${report.ciGates.length} / 豁免 ${report.exempted.length}），${report.workflows.length} 个工作流`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runGateWiringCheck(process.argv[2] ?? REPO_ROOT);
