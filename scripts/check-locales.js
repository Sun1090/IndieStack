#!/usr/bin/env node
/**
 * i18n 翻译完整性门禁入口。
 *
 * 检查逻辑在 src/lib/i18n/translation-values.ts 与 scripts/lib/locales-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（.ts import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "locales-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行翻译完整性校验：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
