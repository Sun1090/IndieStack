/**
 * `AGENTS.md` 索引一致性审计实现。
 *
 * 规则本体在 src/lib/docs/agents-index.ts（纯函数，由 vitest 覆盖）；这里只负责读
 * `AGENTS.md` 与 `agents/` 目录、打印结果并给出退出码。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditAgentsIndex, formatAgentsIndexIssues } from "../../src/lib/docs/agents-index.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const AGENTS_DIR = "agents";

/** 仓库现状快照（导出以便单测用临时目录构造反例）。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  const dir = path.join(repoRoot, AGENTS_DIR);
  return {
    indexContent: fs.readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8"),
    agentFiles: fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort(),
  };
}

/** 返回进程退出码：0 表示索引与目录一致，1 表示存在缺行、编号错、重复行或坏链接。 */
export function runAgentsIndexCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取 AGENTS 索引快照：${error.message}`);
    return 1;
  }

  const issues = auditAgentsIndex({ ...snapshot, agentDir: AGENTS_DIR });
  if (issues.length > 0) {
    console.error(`❌ AGENTS.md 索引不一致（${issues.length} 项）:`);
    console.error(formatAgentsIndexIssues(issues));
    return 1;
  }
  console.log(
    `✅ Agent 索引一致：${snapshot.agentFiles.length} 个文件全部在 Quick Reference 表里登记，` +
      "编号与文件名一致，无重复行、无坏链接",
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runAgentsIndexCheck(process.argv[2] ?? REPO_ROOT);
}
