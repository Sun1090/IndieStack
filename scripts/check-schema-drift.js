#!/usr/bin/env node
/**
 * 生产 schema 漂移探测入口。
 *
 * 判定在 src/lib/db/schema-drift.ts（Vitest 覆盖），IO 在 scripts/lib/schema-drift-check.js；
 * 这里只负责用 Node 原生 type stripping 跑 ESM（import .ts 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "schema-drift-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 schema 漂移探测：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
