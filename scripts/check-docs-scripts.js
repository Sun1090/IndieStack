#!/usr/bin/env node
/**
 * 文档命令校验入口（docs-site scripts.md ↔ package.json）。
 *
 * 判定在 src/lib/docs/scripts-docs.ts（纯函数 + 单测），IO 在 scripts/lib/scripts-docs-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（import .ts 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "scripts-docs-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行文档命令校验：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
