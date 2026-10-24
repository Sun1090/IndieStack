#!/usr/bin/env node
/** 生产部署台账对账入口（判定在 src/lib/ops/deployment-ledger.ts）。 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "deployment-ledger-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行生产部署台账对账：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
