#!/usr/bin/env node
/**
 * 变异核对入口（`pnpm falsify:rules`）：判定逻辑中性化后，规则模块自己的套件必须变红。
 *
 * 判定逻辑与读数在 src/lib/testing/rule-falsification.ts（纯函数，由 vitest 覆盖），
 * 这里只负责改源码、跑套件、复原与打印。
 *
 * **刻意不是 `check:*`**：它要改源码再跑测试，放进 CI 既慢又不自洽
 * （一条门禁靠临时改坏别的文件来工作）。正确形态是按需跑的取证，结论贴进 docs/progress.md。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "rule-falsification-run.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行变异核对：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);