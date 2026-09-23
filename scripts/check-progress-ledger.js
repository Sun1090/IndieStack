#!/usr/bin/env node
/**
 * 进度台账自检入口。
 *
 * 规则本体在 src/lib/docs/progress-ledger.ts，IO 在 scripts/lib/progress-ledger-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（`.ts` import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "progress-ledger-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行进度台账自检：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
