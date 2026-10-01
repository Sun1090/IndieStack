#!/usr/bin/env node
/**
 * 发布文档门禁入口。
 *
 * 校验逻辑与单测共用 src/lib/release/release-docs.ts 与 scripts/lib/release-docs-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（`.ts` import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "release-docs-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行发布文档门禁：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
