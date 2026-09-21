/**
 * 无障碍静态门禁实现（D10）。
 *
 * 规则本体在 src/lib/ui/a11y-rules.ts（纯函数，由 vitest 覆盖）；这里只负责把仓库现状读成
 * snapshot、打印计数器并给出退出码，方便单测直接调用（可传入临时仓库根）。
 *
 * 上一版 `scripts/check-a11y.js` 的图标按钮规则永远不可能命中，而且**不打印任何计数器**，
 * 所以 CI 日志里看不出它其实什么都没做。这里把 scannedFiles / buttons / iconOnlyButtons
 * 全部打出来，空转一眼可见。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditA11y, formatA11yIssues } from "../../src/lib/ui/a11y-rules.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 与状态门禁一致：shadcn 上游基元目录不在受审范围内。 */
export const UI_PRIMITIVES_DIR = "src/components/ui";
const SOURCE_ROOT = "src";
const SOURCE_EXTENSION = /\.tsx$/;
const TEST_FILE = /\.(test|spec)\.tsx?$/;

function collectFiles(root, accumulator) {
  if (!fs.existsSync(root)) return accumulator;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) collectFiles(full, accumulator);
    else if (SOURCE_EXTENSION.test(entry.name) && !TEST_FILE.test(entry.name)) accumulator.push(full);
  }
  return accumulator;
}

/** 把仓库现状读成审计快照（导出以便单测用临时目录构造反例）。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  const excludedDir = path.join(repoRoot, UI_PRIMITIVES_DIR);
  const absolute = collectFiles(path.join(repoRoot, SOURCE_ROOT), []);
  const files = [];
  for (const full of absolute) {
    if (full.startsWith(excludedDir + path.sep)) continue;
    files.push({
      path: path.relative(repoRoot, full).split(path.sep).join("/"),
      content: fs.readFileSync(full, "utf8"),
    });
  }
  return files;
}

/** 执行门禁：返回报告，并在非 `--json` 时打印人类可读结果。 */
export function runA11yCheck(repoRoot = REPO_ROOT, options = {}) {
  const files = buildSnapshot(repoRoot);
  const report = auditA11y(files);
  if (options.json !== true) {
    for (const issue of report.errors) console.error(formatA11yIssues([issue]));
    if (report.errors.length) {
      console.error(`❌ a11y 静态审计失败：${report.errors.length} 个问题`);
    } else {
      const { scannedFiles, buttons, iconOnlyButtons, images } = report.stats;
      console.log(
        `✅ a11y 静态审计通过：${scannedFiles} 个文件、${buttons} 个按钮` +
          `（${iconOnlyButtons} 个纯图标按钮均已标注）、${images} 个 <img> 均带 alt` +
          `（src/components/ui/** 按设计排除）`,
      );
    }
  }
  return report;
}

const invokedDirectly = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const report = runA11yCheck(REPO_ROOT, { json: process.argv.includes("--json") });
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  process.exit(report.errors.length ? 1 : 0);
}
