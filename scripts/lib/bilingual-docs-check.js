/**
 * 双语调度事实一致性检查实现（v0.12.0 D02）。
 *
 * 规则本体在 src/lib/docs/bilingual-facts.ts（纯函数，由 vitest 覆盖）；这里负责遍历
 * `docs-site/` 与 `docs-site/zh-CN/`，把两边的 Markdown 原文交给规则比对。
 *
 * 使用 Node 原生 type stripping 运行，因此导入 .ts 必须写显式相对路径（不能用 `@/` 别名）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditBilingualDocs, formatBilingualDocIssues } from "../../src/lib/docs/bilingual-facts.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 遍历文档站时跳过的目录（构建产物与依赖不是文档事实源）。 */
const SKIP_DIRECTORIES = new Set(["node_modules", ".vitepress", "dist", "public"]);

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

/** 收集 docs-site 下全部 Markdown（仓库相对 POSIX 路径，含 zh-CN）。 */
export function collectBilingualDocs(root = REPO_ROOT) {
  const start = path.join(root, "docs-site");
  const documents = [];
  if (!fs.existsSync(start)) return documents;

  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        documents.push({
          path: toPosixPath(path.relative(root, fullPath)),
          content: fs.readFileSync(fullPath, "utf8"),
        });
      }
    }
  };
  walk(start);
  return documents.sort((left, right) => left.path.localeCompare(right.path));
}

/** 返回进程退出码：0 表示双语调度事实一致，1 表示存在漂移或 IO 错误。 */
export function runBilingualDocsCheck(root = REPO_ROOT) {
  let documents;
  try {
    documents = collectBilingualDocs(root);
  } catch (error) {
    console.error(`❌ 无法读取文档站：${error.message}`);
    return 1;
  }

  const report = auditBilingualDocs(documents);
  if (report.issues.length > 0) {
    console.error(`❌ 双语调度事实一致性校验失败（${report.issues.length} 项）`);
    console.error(formatBilingualDocIssues(report.issues));
    return 1;
  }

  console.log(
    `✅ 双语调度事实一致：${report.pairs.length} 对文档 / ` +
      `${report.facts.cronExpressions.length} 个 cron 表达式 / ` +
      `${report.facts.utcTimes.length} 个 UTC 时刻两边写法相同`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runBilingualDocsCheck(process.argv[2] ?? REPO_ROOT);
