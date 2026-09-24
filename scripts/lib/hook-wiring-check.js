/**
 * Git 钩子层自检的 IO 侧。
 *
 * 规则本体在 src/lib/release/hook-wiring.ts（纯函数，由 vitest 覆盖）；这里只负责
 * 读 `.husky/`、`package.json`、`node_modules/.bin` 与文件存在性。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditHookWiring, formatHookIssues } from "../../src/lib/release/hook-wiring.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const HOOK_DIR = ".husky";
export const BIN_DIR = "node_modules/.bin";

/** 读取自检输入，导出以便单测用临时目录验证 CLI。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const hookDir = path.join(repoRoot, HOOK_DIR);
  const hooks = fs.existsSync(hookDir)
    ? fs
        .readdirSync(hookDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
        .map((entry) => ({
          name: entry.name,
          content: fs.readFileSync(path.join(hookDir, entry.name), "utf8"),
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
    : [];
  const binDir = path.join(repoRoot, BIN_DIR);
  return {
    hooks,
    scripts: pkg.scripts ?? {},
    bins: fs.existsSync(binDir) ? fs.readdirSync(binDir) : [],
    fileExists: (repoPath) => fs.existsSync(path.join(repoRoot, repoPath)),
    binDirPresent: fs.existsSync(binDir),
  };
}

/** 返回进程退出码：0 表示钩子层与声明一致，1 表示存在阻断问题或 IO 错误。 */
export function runHookWiringCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取钩子层快照：${error.message}`);
    return 1;
  }
  const { binDirPresent, ...input } = snapshot;
  if (input.hooks.length > 0 && !binDirPresent) {
    console.error(`❌ ${BIN_DIR} 不存在：先 \`pnpm install\` 再跑本门禁，否则二进制检查全是假阳性`);
    return 1;
  }

  const report = auditHookWiring(input);
  if (report.issues.length > 0) {
    console.error(`❌ Git 钩子层自检失败（${report.issues.length} 项）`);
    console.error(formatHookIssues(report.issues));
    return 1;
  }
  console.log(
    `✅ Git 钩子层自检通过：${report.hookNames.length} 个钩子（${report.hookNames.join(" / ")}），${report.checkedCommands} 条命令全部可解析`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runHookWiringCheck(process.argv[2] ?? REPO_ROOT);
