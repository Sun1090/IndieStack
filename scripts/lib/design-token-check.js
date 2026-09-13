/**
 * 设计 token 门禁实现（G02）。
 *
 * 规则本体在 src/lib/design/tokens.ts（纯函数，由 vitest 覆盖）；这里只负责把仓库现状读成
 * snapshot、打印结果并给出退出码，方便单测直接调用（可传入临时仓库根）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditDesignTokens, formatDesignTokenIssues } from "../../src/lib/design/tokens.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 应用层：排除 shadcn 上游基元（写法跟随上游版本）与门禁自身。 */
export const UI_PRIMITIVES_DIR = "src/components/ui";
const SELF_REFERENTIAL_FILES = ["src/lib/design/tokens.ts"];
const GLOBALS_CSS = "src/app/globals.css";
const SOURCE_ROOTS = ["src/app", "src/components", "src/hooks", "src/lib"];
const SOURCE_EXTENSION = /\.tsx?$/;

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
  const cssPath = path.join(repoRoot, GLOBALS_CSS);
  if (!fs.existsSync(cssPath)) throw new Error(`找不到 ${GLOBALS_CSS}`);

  const excludedDir = path.join(repoRoot, UI_PRIMITIVES_DIR);
  const sourceFiles = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of collectFiles(
      path.join(repoRoot, root),
      (f) => SOURCE_EXTENSION.test(f) && !isTestFile(f),
    )) {
      if (file.startsWith(excludedDir + path.sep)) continue;
      const relative = toRepoPath(repoRoot, file);
      if (SELF_REFERENTIAL_FILES.includes(relative)) continue;
      sourceFiles.push({ path: relative, content: fs.readFileSync(file, "utf8") });
    }
  }

  return { css: fs.readFileSync(cssPath, "utf8"), sourceFiles };
}

/** 返回进程退出码：0 表示 token 一致，1 表示存在阻断问题。 */
export function runDesignTokenCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取设计 token 快照：${error.message}`);
    return 1;
  }

  const report = auditDesignTokens(snapshot);
  if (report.warnings.length > 0) console.warn(formatDesignTokenIssues("warning", report.warnings));
  if (report.errors.length > 0) {
    console.error(`❌ 设计 token 门禁失败（${report.errors.length} 项）`);
    console.error(formatDesignTokenIssues("error", report.errors));
    return 1;
  }
  const { registered, darkOverridden, colorMappings, scannedFiles } = report.stats;
  console.log(
    `✅ 设计 token 校验通过：${registered} 个已登记 token（${darkOverridden} 个深色覆盖、${colorMappings} 条 @theme 映射），${scannedFiles} 个应用层文件未使用原生状态调色板`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runDesignTokenCheck(process.argv[2] ?? REPO_ROOT);
}
