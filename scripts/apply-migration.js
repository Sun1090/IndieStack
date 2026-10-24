#!/usr/bin/env node
/** 云端迁移应用入口（判定在 src/lib/db/migration-apply.ts，IO 在 scripts/lib/migration-apply-cli.js）。 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "migration-apply-cli.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行云端迁移应用：${result.error.message}`);
  console.error("   注意：这是显式的写工具——只应在人核对过 dry-run 计划后带 --apply 运行。");
  process.exit(1);
}
process.exit(result.status ?? 1);
