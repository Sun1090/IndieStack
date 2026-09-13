/**
 * Tailwind v4 原生主题门禁实现。
 *
 * 规则本体在 src/lib/tailwind/native-theme.ts（纯函数，由 vitest 覆盖）；这里只负责把仓库
 * 现状读成 snapshot、打印结果并给出退出码，方便单测直接调用（可传入临时仓库根）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditTailwindNative, formatTailwindNativeIssues } from "../../src/lib/tailwind/native-theme.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 应用层：排除 shadcn 上游基元（写法跟随上游版本）。 */
export const UI_PRIMITIVES_DIR = "src/components/ui";
/** 门禁自身的规则表必须逐字写下被禁类名，因此这个文件不参与自检（其余 src 全覆盖）。 */
const SELF_REFERENTIAL_FILES = ["src/lib/tailwind/native-theme.ts"];
const CONFIG_BASENAMES = [
  "tailwind.config.js",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
  "tailwind.config.ts",
  "tailwind.config.mts",
  "tailwind.config.cts",
];
const SOURCE_ROOTS = ["src/app", "src/components", "src/hooks", "src/lib"];
const SOURCE_EXTENSION = /\.tsx?$/;

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function isTestFile(absolutePath) {
  return /\.(test|spec)\.tsx?$/.test(absolutePath);
}

function collectFiles(repoRoot, root, predicate) {
  if (!fs.existsSync(root)) return [];
  const excludedDir = path.join(repoRoot, UI_PRIMITIVES_DIR);
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (full === excludedDir) continue;
      results.push(...collectFiles(repoRoot, full, predicate));
    } else if (predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

/** 把仓库现状读成审计快照（导出以便单测用临时目录构造反例）。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  const read = (file) => fs.readFileSync(file, "utf8");
  const asFile = (file) => ({ path: toRepoPath(repoRoot, file), content: read(file) });

  const configFiles = CONFIG_BASENAMES.filter((name) => fs.existsSync(path.join(repoRoot, name)));

  const cssFiles = collectFiles(repoRoot, path.join(repoRoot, "src"), (file) => file.endsWith(".css")).map(asFile);

  const sourceFiles = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of collectFiles(repoRoot, path.join(repoRoot, root), (f) => SOURCE_EXTENSION.test(f) && !isTestFile(f))) {
      const relative = toRepoPath(repoRoot, file);
      if (SELF_REFERENTIAL_FILES.includes(relative)) continue;
      sourceFiles.push({ path: relative, content: read(file) });
    }
  }

  const excludedFiles = collectFiles(
    repoRoot,
    path.join(repoRoot, UI_PRIMITIVES_DIR),
    (file) => SOURCE_EXTENSION.test(file) && !isTestFile(file),
  ).map(asFile);

  const pkg = JSON.parse(read(path.join(repoRoot, "package.json")));
  const dependencies = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];

  return { configFiles, cssFiles, sourceFiles, excludedFiles, dependencies };
}

/** 返回进程退出码：0 表示符合 v4 原生写法，1 表示存在阻断回退。 */
export function runTailwindNativeCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取 Tailwind 主题快照：${error.message}`);
    return 1;
  }

  const report = auditTailwindNative(snapshot);
  if (report.warnings.length > 0) console.warn(formatTailwindNativeIssues("warning", report.warnings));
  if (report.errors.length > 0) {
    console.error(`❌ Tailwind v4 原生主题门禁失败（${report.errors.length} 项）`);
    console.error(formatTailwindNativeIssues("error", report.errors));
    return 1;
  }
  console.log(
    `✅ Tailwind v4 原生主题校验通过：无 @config/JS 配置，${snapshot.cssFiles.length} 个样式文件、${snapshot.sourceFiles.length} 个应用层文件写法合规`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runTailwindNativeCheck(process.argv[2] ?? REPO_ROOT);
}
