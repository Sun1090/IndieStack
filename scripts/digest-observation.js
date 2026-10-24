#!/usr/bin/env node
/** digest 端到端读数入口（判定在 src/lib/db/digest-observation.ts，IO 在 scripts/lib/ 同名模块）。 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "digest-observation-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 digest 端到端读数：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
