#!/usr/bin/env node
/**
 * CHANGELOG 与 git tag 对账门禁入口。
 *
 * 校验逻辑与单测共用 src/lib/release/changelog-tag-reconciliation.ts 与
 * scripts/lib/changelog-tag-check.js，这里只负责用 Node 原生 type stripping 运行 ESM。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "changelog-tag-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 CHANGELOG/tag 对账：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
