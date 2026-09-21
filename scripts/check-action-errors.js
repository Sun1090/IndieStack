#!/usr/bin/env node
/**
 * Server Action 错误码翻译门禁入口（D02 / D03）。
 *
 * 规则本体在 src/lib/i18n/action-errors.ts，IO 在 scripts/lib/action-error-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（.ts import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "action-error-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行错误码翻译校验：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
