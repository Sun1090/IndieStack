/**
 * 加载 / 空 / 错误状态门禁实现（G04）。
 *
 * 规则本体在 src/lib/ui/state-rules.ts（纯函数，由 vitest 覆盖）；这里只负责把仓库现状读成
 * snapshot、打印结果并给出退出码，方便单测直接调用（可传入临时仓库根）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditStates, formatStateIssues } from "../../src/lib/ui/state-rules.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 应用层：排除 shadcn 上游基元（写法跟随上游版本）。 */
export const UI_PRIMITIVES_DIR = "src/components/ui";
const SOURCE_ROOTS = ["src/app", "src/components"];
const SOURCE_EXTENSION = /\.tsx$/;
const ROUTE_LOADING_FILE = /(^|\/)loading\.tsx$/;

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

  // `src/components/ui` 是上游基元目录，但 G04 已删除的重复加载组件若出现在别处也要能被发现，
  // 因此这里只排除 ui 目录，其余组件目录全量收集。
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

  const routeLoadingFiles = sourceFiles.filter((file) => ROUTE_LOADING_FILE.test(file.path));

  return { sourceFiles, routeLoadingFiles };
}

/** 返回进程退出码：0 表示写法合规，1 表示存在阻断回退。 */
export function runStateCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取状态组件快照：${error.message}`);
    return 1;
  }

  const report = auditStates(snapshot);
  if (report.errors.length > 0) {
    console.error(`❌ 共享状态门禁失败（${report.errors.length} 项）`);
    console.error(formatStateIssues(report.errors));
    return 1;
  }
  console.log(
    `✅ 状态组件校验通过：${report.stats.scannedFiles} 个应用层文件、${report.stats.routeLoadingFiles} 个 loading.tsx 统一走 PageLoading / EmptyState / ErrorState`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runStateCheck(process.argv[2] ?? REPO_ROOT);
}
