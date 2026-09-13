#!/usr/bin/env node
/**
 * cron worker 调度与指标契约门禁入口（E03）。
 *
 * 校验逻辑与单测共用 src/lib/observability/cron-contract.ts 与
 * scripts/lib/cron-contract-check.js，这里只负责用 Node 原生 type stripping 运行 ESM。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "cron-contract-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 cron 契约校验：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
