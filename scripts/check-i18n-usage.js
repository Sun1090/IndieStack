#!/usr/bin/env node
/**
 * next-intl 静态 missing-key 门禁入口。
 *
 * 校验逻辑与单测共用 src/lib/i18n/translation-usage.ts 与 scripts/lib/i18n-usage-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（`.ts` import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "i18n-usage-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 i18n missing-key 门禁：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
