#!/usr/bin/env node
/**
 * 无障碍静态门禁入口（D10）。
 *
 * 校验逻辑与单测共用 src/lib/ui/a11y-rules.ts 与 scripts/lib/a11y-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（.ts import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "a11y-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 a11y 静态审计：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
