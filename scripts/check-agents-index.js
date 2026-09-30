#!/usr/bin/env node
/**
 * AGENTS.md 索引一致性审计入口。
 *
 * 校验逻辑与单测共用 src/lib/docs/agents-index.ts 与 scripts/lib/agents-index-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（`.ts` import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "agents-index-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 AGENTS 索引审计：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
