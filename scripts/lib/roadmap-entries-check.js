/**
 * 任务池条目状态纪律的 IO 侧。
 *
 * 规则本体在 src/lib/release/roadmap-entries.ts（纯函数，由 vitest 覆盖）；
 * 这里只负责读文件与打印。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatRoadmapIssues,
  inspectRoadmapEntries,
  parseTaskPoolEntries,
} from "../../src/lib/release/roadmap-entries.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const ROADMAP_PATH = "docs/roadmap-0.12.0.md";

/** 返回进程退出码：0 表示每条条目都有交代，1 表示有没交代的或读不出来。 */
export function runRoadmapEntriesCheck(repoRoot = REPO_ROOT) {
  const file = path.join(repoRoot, ROADMAP_PATH);
  let markdown;
  try {
    markdown = fs.readFileSync(file, "utf8");
  } catch (error) {
    console.error(`❌ 读不到 ${ROADMAP_PATH}：${error.message}`);
    return 1;
  }

  const issues = inspectRoadmapEntries(markdown);
  if (issues.length > 0) {
    console.error(`❌ 任务池条目状态纪律检查失败（${issues.length} 项）`);
    console.error(formatRoadmapIssues(issues));
    return 1;
  }
  const entries = parseTaskPoolEntries(markdown);
  // 分母打在读数里：空数组报绿就是这条规则唯一会失效的方式，所以读数要能被一眼看出是不是 0。
  console.log(`✅ 任务池条目均有交代：${entries.length} 条，完成标注或阻塞理由二者必居其一`);
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runRoadmapEntriesCheck(process.argv[2] ?? REPO_ROOT);
