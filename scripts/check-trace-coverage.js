#!/usr/bin/env node
/**
 * 请求链路追踪覆盖门禁入口（E02）。
 *
 * 校验逻辑与单测共用 src/lib/observability/trace-coverage.ts 与
 * scripts/lib/trace-coverage-check.js，这里只负责用 Node 原生 type stripping 运行 ESM。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "trace-coverage-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行请求追踪覆盖校验：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
