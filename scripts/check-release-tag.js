#!/usr/bin/env node
/**
 * Tag / GitHub Release 自动化门禁入口（J07）。
 *
 * 校验逻辑与单测共用 src/lib/release/release-tag-policy.ts 与
 * scripts/lib/release-tag-check.js，这里只负责用 Node 原生 type stripping 运行 ESM。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "release-tag-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行发布标签校验：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
