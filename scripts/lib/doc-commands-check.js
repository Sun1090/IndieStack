/**
 * 文档命令可达性审计实现。
 *
 * 规则本体在 src/lib/docs/doc-commands.ts（纯函数，由 vitest 覆盖）；这里只负责
 * 列出受审 markdown、读 package.json 与 node_modules/.bin、打印结果并给出退出码。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditDocCommands,
  formatDocCommandIssues,
  formatDocCommandSummary,
  selectScopedDocs,
} from "../../src/lib/docs/doc-commands.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 遍历时跳过的目录：依赖、构建产物、点目录（`.vitepress/dist` 里是生成物）。 */
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".next", "coverage"]);

/** 列出仓库里全部 markdown（仓库相对路径、已排序）。 */
export function listMarkdownFiles(repoRoot, directory = repoRoot, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      listMarkdownFiles(repoRoot, full, found);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(path.relative(repoRoot, full).split(path.sep).join("/"));
    }
  }
  return found;
}

/**
 * `node_modules/.bin` 里的文件名——「这条命令能不能跑」的地面真相。
 *
 * 读不到就返回 `null` 而不是空集合：空集合会说「一个二进制都没有」，
 * 而真相是「没装依赖」，两者的处置完全不同（前者补依赖，后者先 `pnpm install`）。
 */
export function readLocalBinaries(repoRoot) {
  try {
    return new Set(fs.readdirSync(path.join(repoRoot, "node_modules", ".bin")));
  } catch {
    return null;
  }
}

/** 仓库现状快照（导出以便单测用临时目录构造反例）。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const selection = selectScopedDocs(listMarkdownFiles(repoRoot));
  const contents = {};
  for (const file of selection.scoped) {
    contents[file] = fs.readFileSync(path.join(repoRoot, file), "utf8");
  }
  return {
    files: selection.scoped,
    contents,
    exclusions: {
      exclusions: selection.exclusions,
      unusedExclusions: selection.unusedExclusions,
    },
    binaries: readLocalBinaries(repoRoot),
    scripts: pkg.scripts ?? {},
    dependencies: { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) },
  };
}

/** 返回进程退出码：0 表示每条命令都有落点，1 表示有命令指向不存在的东西。 */
export function runDocCommandsCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取受审文档快照：${error.message}`);
    return 1;
  }

  const report = auditDocCommands(snapshot);
  if (report.errors.length > 0) {
    console.error(formatDocCommandIssues(report.errors));
    return 1;
  }
  console.log(formatDocCommandSummary(report));
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runDocCommandsCheck(process.argv[2] ?? REPO_ROOT);
}