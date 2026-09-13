/**
 * 贡献者测试矩阵一致性检查实现（I09）。
 *
 * 规则本体在 src/lib/testing/test-matrix.ts（纯函数，由 vitest 覆盖）；这里负责读取
 * package.json scripts、中英两份矩阵文档，并额外确认每个登记路径在磁盘上仍然存在。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditTestMatrix,
  formatTestMatrixIssues,
  TEST_MATRIX,
} from "../../src/lib/testing/test-matrix.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MATRIX_DOC_PATHS = ["docs-site/testing.md", "docs-site/zh-CN/testing.md"];

/** 读取 package.json 的 scripts 注册表。 */
export function readScripts(repoRoot = REPO_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  return pkg.scripts ?? {};
}

/** 列出注册表里在磁盘上不存在的覆盖路径。 */
export function collectMissingPaths(repoRoot = REPO_ROOT) {
  const missing = [];
  for (const area of TEST_MATRIX) {
    for (const repoPath of area.paths) {
      if (!fs.existsSync(path.join(repoRoot, repoPath))) {
        missing.push(`${area.id}: ${repoPath}`);
      }
    }
  }
  return missing;
}

/** 读取矩阵校验所需的全部输入，导出以便测试用临时目录验证 CLI。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  return {
    scripts: readScripts(repoRoot),
    documents: MATRIX_DOC_PATHS.map((relative) => ({
      path: relative,
      content: fs.readFileSync(path.join(repoRoot, relative), "utf8"),
    })),
  };
}

/** 返回进程退出码：0 表示矩阵与仓库事实一致，1 表示存在漂移或 IO 错误。 */
export function runTestMatrixCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  let missingPaths;
  try {
    snapshot = buildSnapshot(repoRoot);
    missingPaths = collectMissingPaths(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取贡献者测试矩阵快照：${error.message}`);
    return 1;
  }

  const report = auditTestMatrix(snapshot);
  const issues = [...report.issues];
  for (const detail of missingPaths) {
    issues.push({
      code: "MATRIX_MISSING_PATH",
      path: "filesystem",
      detail: `覆盖路径不存在：${detail}`,
    });
  }

  if (issues.length > 0) {
    console.error(`❌ 贡献者测试矩阵校验失败（${issues.length} 项）`);
    console.error(formatTestMatrixIssues(issues));
    return 1;
  }
  console.log(
    `✅ 贡献者测试矩阵通过：${report.areas} 个领域 / ${report.commands} 条门禁 × ${snapshot.documents.length} 份文档`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runTestMatrixCheck(process.argv[2] ?? REPO_ROOT);
