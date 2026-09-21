#!/usr/bin/env node
/**
 * Production Smoke workflow contract gate.
 *
 * 规则本体在 src/lib/deployment/production-smoke-contract.ts（由 vitest 覆盖）；
 * 这里复用 workflow-policy-check 的文件读取层，并启动 Node type stripping 运行 ESM。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "production-smoke-contract-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 Production Smoke 工作流契约校验：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
