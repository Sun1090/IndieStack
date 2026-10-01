/**
 * 发布文档门禁实现。
 *
 * 规则本体在 src/lib/release/release-docs.ts（纯函数，由 vitest 覆盖）；这里只负责把仓库现状
 * 读成 snapshot、打印结果并给出退出码。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditReleaseDocs,
  formatReleaseDocsIssues,
  formatReleaseDocsSummary,
} from "../../src/lib/release/release-docs.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOC_DIR = "docs/operations";

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

/** 需要读内容的文档：固定四份 + 当前版本的三份。 */
function contentTargets(version) {
  return [
    ".github/RELEASE_CHECKLIST.md",
    "CHANGELOG.md",
    "README.md",
    "README.zh-CN.md",
    `${DOC_DIR}/release-runbook-v${version}.md`,
    `${DOC_DIR}/rollback-runbook-v${version}.md`,
    `${DOC_DIR}/production-smoke-v${version}.md`,
  ];
}

/** 仓库现状快照（导出以便单测用临时目录构造反例）。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const docDir = path.join(repoRoot, DOC_DIR);
  const docFiles = fs.existsSync(docDir) ? fs.readdirSync(docDir).filter((f) => f.endsWith(".md")) : [];
  const contents = {};
  for (const rel of contentTargets(version)) {
    const abs = path.join(repoRoot, rel);
    if (fs.existsSync(abs)) contents[rel] = fs.readFileSync(abs, "utf8");
  }
  return { version, docFiles, contents };
}

/** 返回进程退出码：0 表示通过，1 表示缺文件、缺关键词或三族不自洽。 */
export function runReleaseDocsCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取发布文档快照：${error.message}`);
    return 1;
  }

  const report = auditReleaseDocs(snapshot);
  if (report.errors.length > 0) {
    console.error(formatReleaseDocsIssues(report.errors));
    return 1;
  }
  console.log(formatReleaseDocsSummary(report));
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runReleaseDocsCheck(process.argv[2] ?? REPO_ROOT);
}
