#!/usr/bin/env node
/**
 * 动态翻译键契约门禁入口（D04 补集）。
 *
 * 校验逻辑与单测共用 src/lib/i18n/dynamic-keys.ts 与 scripts/lib/dynamic-keys-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（.ts import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "dynamic-keys-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行动态翻译键契约：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
