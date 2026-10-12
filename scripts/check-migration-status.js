#!/usr/bin/env node
/** 云端迁移状态探测入口（判定在 src/lib/db/migration-status.ts，IO 在 scripts/lib/ 同名模块）。 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "migration-status-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行云端迁移状态探测：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
