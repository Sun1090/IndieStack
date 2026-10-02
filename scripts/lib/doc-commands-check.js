/**
 * 入门文档命令可达性审计实现。
 *
 * 规则本体在 src/lib/docs/doc-commands.ts（纯函数，由 vitest 覆盖）；这里只负责读那四份
 * 受审文档与 package.json、打印结果并给出退出码。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCOPED_DOCS,
  auditDocCommands,
  formatDocCommandIssues,
  formatDocCommandSummary,
} from "../../src/lib/docs/doc-commands.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 仓库现状快照（导出以便单测用临时目录构造反例）。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const files = SCOPED_DOCS.filter((file) => fs.existsSync(path.join(repoRoot, file)));
  const contents = {};
  for (const file of files) {
    contents[file] = fs.readFileSync(path.join(repoRoot, file), "utf8");
  }
  return {
    files,
    contents,
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
    console.error(`❌ 无法读取入门文档快照：${error.message}`);
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
