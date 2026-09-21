#!/usr/bin/env node
/**
 * 存储孤儿巡检入口（A10）。
 *
 * 逻辑在 src/lib/uploads/orphan-audit.ts 与 scripts/lib/storage-orphans.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（.ts import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "storage-orphans.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行孤儿巡检：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
