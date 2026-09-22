#!/usr/bin/env node
/**
 * 查询错误通道门禁入口。
 *
 * 规则在 src/lib/security/query-error-channel.ts（Vitest 覆盖），IO 在
 * scripts/lib/query-error-channel-check.js；这里只负责用 Node 原生 type stripping
 * 跑 ESM（import .ts 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "query-error-channel-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行查询错误通道校验：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
