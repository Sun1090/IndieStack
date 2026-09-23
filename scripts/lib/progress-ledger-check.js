/**
 * 进度台账自检的 IO 侧。
 *
 * 规则本体在 src/lib/docs/progress-ledger.ts（纯函数，由 vitest 覆盖）；
 * 这里只负责读文件与打印。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProgressLedger, formatLedgerIssues } from "../../src/lib/docs/progress-ledger.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LEDGER_PATH = "docs/progress.md";

/** 返回进程退出码：0 表示台账自洽，1 表示有损坏或读不出来。 */
export function runProgressLedgerCheck(repoRoot = REPO_ROOT) {
  const file = path.join(repoRoot, LEDGER_PATH);
  let markdown;
  try {
    markdown = fs.readFileSync(file, "utf8");
  } catch (error) {
    console.error(`❌ 读不到 ${LEDGER_PATH}：${error.message}`);
    return 1;
  }

  const report = auditProgressLedger(markdown);
  if (report.issues.length > 0) {
    console.error(`❌ 进度台账自检失败（${report.issues.length} 项）`);
    console.error(formatLedgerIssues(report.issues));
    return 1;
  }
  console.log(`✅ 进度台账自检通过：${report.entries.length} 条条目，日期非递减且标题无重复`);
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runProgressLedgerCheck(process.argv[2] ?? REPO_ROOT);
