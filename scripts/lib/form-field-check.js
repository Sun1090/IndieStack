/**
 * 共享表单字段门禁实现（G03）。
 *
 * 规则本体在 src/lib/ui/form-field-rules.ts（纯函数，由 vitest 覆盖）；这里只负责把仓库现状读成
 * snapshot、打印结果并给出退出码，方便单测直接调用（可传入临时仓库根）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditFormFields, formatFormFieldIssues } from "../../src/lib/ui/form-field-rules.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 应用层：排除 shadcn 上游基元（写法跟随上游版本）。 */
export const UI_PRIMITIVES_DIR = "src/components/ui";
const SOURCE_ROOTS = ["src/app", "src/components"];
const SOURCE_EXTENSION = /\.tsx$/;

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function isTestFile(absolutePath) {
  return /\.(test|spec)\.tsx?$/.test(absolutePath);
}

function collectFiles(root, predicate) {
  if (!fs.existsSync(root)) return [];
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...collectFiles(full, predicate));
    else if (predicate(full)) results.push(full);
  }
  return results;
}

/** 把仓库现状读成审计快照（导出以便单测用临时目录构造反例）。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  const excludedDir = path.join(repoRoot, UI_PRIMITIVES_DIR);
  const sourceFiles = [];
  for (const root of SOURCE_ROOTS) {
    const files = collectFiles(
      path.join(repoRoot, root),
      (f) => SOURCE_EXTENSION.test(f) && !isTestFile(f),
    );
    for (const file of files) {
      if (file.startsWith(excludedDir + path.sep)) continue;
      sourceFiles.push({
        path: toRepoPath(repoRoot, file),
        content: fs.readFileSync(file, "utf8"),
      });
    }
  }
  return { sourceFiles };
}

/** 返回进程退出码：0 表示写法合规，1 表示存在阻断回退。 */
export function runFormFieldCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取表单字段快照：${error.message}`);
    return 1;
  }

  const report = auditFormFields(snapshot);
  if (report.errors.length > 0) {
    console.error(`❌ 共享表单字段门禁失败（${report.errors.length} 项）`);
    console.error(formatFormFieldIssues(report.errors));
    return 1;
  }
  console.log(
    `✅ 共享表单字段校验通过：${report.stats.scannedFiles} 个应用层文件统一走 FormField / NativeSelect，无原生 <select>、无复制类名，且每个 <form> 都声明了 method="post"`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runFormFieldCheck(process.argv[2] ?? REPO_ROOT);
}
