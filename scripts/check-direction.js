#!/usr/bin/env node
/**
 * 书写方向门禁入口。
 *
 * 规则在 src/lib/styling/direction.ts（纯函数）与 scripts/lib/direction-check.js（IO），
 * 这里只负责用 Node 原生 type stripping 运行 ESM（.ts import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "direction-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`\u274c 无法运行书写方向检查：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
