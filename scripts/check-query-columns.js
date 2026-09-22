#!/usr/bin/env node
/**
 * 查询列名一致性门禁入口。
 *
 * 规则在 src/lib/db/query-columns.ts（Vitest 覆盖），IO 在 scripts/lib/query-columns-check.js；
 * 这里只负责用 Node 原生 type stripping 跑 ESM（import .ts 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "query-columns-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行查询列名校验：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
