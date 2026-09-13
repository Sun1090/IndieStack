#!/usr/bin/env node
/**
 * 门禁接线审计入口（I06 / J01）。
 *
 * 校验逻辑与单测共用 src/lib/release/gate-wiring.ts 与 scripts/lib/gate-wiring-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（.ts import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "gate-wiring-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行门禁接线审计：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
