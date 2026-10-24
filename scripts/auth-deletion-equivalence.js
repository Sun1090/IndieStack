#!/usr/bin/env node
/** 本地栈的「SQL 删除 vs 真 deleteUser」等价性实验入口（判定在 src/lib/drills/auth-deletion-equivalence.ts）。 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "auth-deletion-equivalence-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行等价性实验：${result.error.message}`);
  console.error("   这是**写本地栈**的实验（删自己建的演练账号）；它不碰生产，生产侧只读 /auth/v1/health。");
  process.exit(1);
}
process.exit(result.status ?? 1);
