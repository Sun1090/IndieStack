/**
 * Mock 文档一致性检查实现（I07）。
 *
 * 规则本体在 src/lib/mock/mock-docs.ts（纯函数，由 vitest 覆盖）；这里负责读取
 * Mock 客户端源码、E2E 路由目录（src/app/api/e2e/<name>/route.ts）与三份 Mock 文档。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditMockDocs, formatMockDocIssues } from "../../src/lib/mock/mock-docs.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MOCK_INDEX_PATH = "src/lib/mock/index.ts";
export const E2E_ROUTE_DIR = "src/app/api/e2e";
export const MOCK_DOC_PATHS = [
  "docs-site/mock.md",
  "docs-site/zh-CN/mock.md",
  "docs/architecture/13-mock-system.md",
];

/** 列出 src/app/api/e2e 下所有已实现 route.ts 的仓库相对路径。 */
export function collectE2eRoutePaths(repoRoot = REPO_ROOT) {
  const root = path.join(repoRoot, E2E_ROUTE_DIR);
  return fs
    .readdirSync(root)
    .filter((name) => fs.statSync(path.join(root, name)).isDirectory())
    .map((name) => path.join(root, name, "route.ts"))
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => path.relative(repoRoot, candidate).split(path.sep).join("/"))
    .sort();
}

/** 读取 Mock 文档校验所需的全部输入，导出以便测试用临时目录验证 CLI。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  return {
    mockIndexSource: fs.readFileSync(path.join(repoRoot, MOCK_INDEX_PATH), "utf8"),
    e2eRoutePaths: collectE2eRoutePaths(repoRoot),
    documents: MOCK_DOC_PATHS.map((relative) => ({
      path: relative,
      content: fs.readFileSync(path.join(repoRoot, relative), "utf8"),
    })),
  };
}

/** 返回进程退出码：0 表示文档与 Mock 实现一致，1 表示存在漂移或 IO 错误。 */
export function runMockDocsCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取 Mock 文档快照：${error.message}`);
    return 1;
  }

  const report = auditMockDocs(snapshot);
  if (report.issues.length > 0) {
    console.error(`❌ Mock 文档一致性检查失败（${report.issues.length} 项）`);
    console.error(formatMockDocIssues(report.issues));
    return 1;
  }
  console.log(
    `✅ Mock 文档一致性通过：${report.tables.length} 张表 / ${report.endpoints.length} 个 E2E 端点 × ${snapshot.documents.length} 份文档`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runMockDocsCheck(process.argv[2] ?? REPO_ROOT);
