#!/usr/bin/env node
/**
 * Git 钩子层自检入口。
 *
 * 规则本体在 src/lib/release/hook-wiring.ts，IO 在 scripts/lib/hook-wiring-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（`.ts` import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "hook-wiring-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 Git 钩子层自检：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
