/**
 * Provider documentation parity check implementation (I08).
 *
 * The runtime registry is the source of truth; both locale guides must mention
 * every provider id and every environment key. The check fails closed when a
 * guide is missing or unreadable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditProviderDocs,
  formatProviderDocIssues,
} from "../../src/lib/providers/provider-docs.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PROVIDER_DOC_PATHS = [
  "docs-site/provider-diagnostics.md",
  "docs-site/zh-CN/provider-diagnostics.md",
];

export function buildSnapshot(repoRoot = REPO_ROOT) {
  return PROVIDER_DOC_PATHS.map((relative) => ({
    path: relative,
    content: fs.readFileSync(path.join(repoRoot, relative), "utf8"),
  }));
}

export function runProviderDocsCheck(repoRoot = REPO_ROOT) {
  let documents;
  try {
    documents = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取 provider 文档：${error.message}`);
    return 1;
  }

  const report = auditProviderDocs(documents);
  if (report.issues.length > 0) {
    console.error(`❌ provider 文档一致性检查失败（${report.issues.length} 项）`);
    console.error(formatProviderDocIssues(report.issues));
    return 1;
  }
  console.log(
    `✅ provider 文档一致性通过：${report.providers} 个 provider / ${report.keys / documents.length} 个环境变量 × ${documents.length} 份文档`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runProviderDocsCheck(process.argv[2] ?? REPO_ROOT);
