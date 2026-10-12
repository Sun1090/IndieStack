#!/usr/bin/env node
/** CodeQL 告警台账对账入口（判定在 src/lib/security/codeql-alert-registry.ts）。 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "codeql-alert-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 CodeQL 告警台账对账：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
