#!/usr/bin/env node
/**
 * 双语调度事实一致性门禁入口（v0.12.0 D02）。
 *
 * 校验逻辑与单测共用 src/lib/docs/bilingual-facts.ts 与 scripts/lib/bilingual-docs-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（.ts import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "bilingual-docs-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行双语调度事实检查：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
