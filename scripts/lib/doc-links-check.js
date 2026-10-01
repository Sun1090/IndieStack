/**
 * 文档内部链接可达性审计实现。
 *
 * 规则本体在 src/lib/docs/doc-links.ts（纯函数，由 vitest 覆盖）；这里只负责收集 markdown
 * 文件、读内容、给出 `exists` 谓词、打印结果并给出退出码。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditDocLinks,
  formatDocLinkIssues,
  formatDocLinkSummary,
} from "../../src/lib/docs/doc-links.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** 受审范围：站点文档 + 仓库文档 + 两份 README + AGENTS 索引。 */
const SCAN_ROOTS = ["docs", "docs-site"];
const EXTRA_FILES = ["README.md", "README.zh-CN.md", "AGENTS.md"];
const SITE_ROOT = "docs-site";

function collectMarkdown(root, repoRoot, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) collectMarkdown(full, repoRoot, out);
    else if (entry.name.endsWith(".md")) {
      out.push(path.relative(repoRoot, full).split(path.sep).join("/"));
    }
  }
  return out;
}

/** 仓库现状快照（导出以便单测用临时目录构造反例）。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  const files = [
    ...SCAN_ROOTS.flatMap((root) => collectMarkdown(path.join(repoRoot, root), repoRoot)),
    ...EXTRA_FILES.filter((file) => fs.existsSync(path.join(repoRoot, file))),
  ].sort();
  const contents = {};
  for (const file of files) {
    contents[file] = fs.readFileSync(path.join(repoRoot, file), "utf8");
  }
  return { files, contents };
}

/** 返回进程退出码：0 表示全部可达，1 表示有断链或没扫到任何文件。 */
export function runDocLinksCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取文档快照：${error.message}`);
    return 1;
  }

  const report = auditDocLinks({
    ...snapshot,
    siteRoot: SITE_ROOT,
    exists: (repoPath) => {
      const abs = path.join(repoRoot, repoPath);
      return fs.existsSync(abs) && fs.statSync(abs).isFile();
    },
  });

  if (report.errors.length > 0) {
    console.error(formatDocLinkIssues(report.errors));
    return 1;
  }
  console.log(formatDocLinkSummary(report));
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runDocLinksCheck(process.argv[2] ?? REPO_ROOT);
}
