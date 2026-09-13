/**
 * ADR 治理门禁实现（I04）。
 *
 * 规则本体在 src/lib/adr/adr-rules.ts（纯函数，由 vitest 覆盖）；这里负责读取
 * docs/adr 目录与 README 索引，打印带文件/行号的问题并返回退出码。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditAdrRepository, formatAdrIssues } from "../../src/lib/adr/adr-rules.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const ADR_DIR = "docs/adr";
export const ADR_INDEX = "docs/adr/README.md";

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

/** 读取仓库中的 ADR 文件与索引，导出以便测试用临时目录验证 CLI。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  const directory = path.join(repoRoot, ADR_DIR);
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.startsWith("adr-") && name.endsWith(".md"))
    .sort()
    .map((name) => ({
      path: toRepoPath(repoRoot, path.join(directory, name)),
      content: fs.readFileSync(path.join(directory, name), "utf8"),
    }));
  const indexMarkdown = fs.readFileSync(path.join(repoRoot, ADR_INDEX), "utf8");
  return { files, indexMarkdown, indexFile: ADR_INDEX };
}

/** 返回进程退出码：0 表示 ADR 结构合法，1 表示存在阻断问题或 IO 错误。 */
export function runAdrCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取 ADR 快照：${error.message}`);
    return 1;
  }

  const report = auditAdrRepository(snapshot);
  if (report.errors.length > 0) {
    console.error(`❌ ADR 治理门禁失败（${report.errors.length} 项）`);
    console.error(formatAdrIssues(report.errors));
    return 1;
  }
  console.log(
    `✅ ADR 治理通过：${report.stats.documents} 篇（接受 ${report.stats.accepted} / 提议 ${report.stats.proposed} / 已废弃 ${report.stats.superseded}），索引 ${report.stats.indexed} 条`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runAdrCheck(process.argv[2] ?? REPO_ROOT);
