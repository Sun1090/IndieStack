#!/usr/bin/env node
/**
 * ADR 治理门禁入口（I04）。
 *
 * 校验逻辑与单测共用 src/lib/adr/adr-rules.ts 与 scripts/lib/adr-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（.ts import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "adr-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 ADR 校验：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
