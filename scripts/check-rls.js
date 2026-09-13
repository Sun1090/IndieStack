#!/usr/bin/env node
/**
 * RLS 全表回归门禁入口。
 *
 * 规则实现与单测共用 `src/lib/security/rls-coverage.ts`，这里只负责用 Node 原生
 * type stripping 运行 ESM（.ts import 需要该 flag），保持 package script 在 Node 22/26 都可用。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "rls-coverage-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 RLS 全表回归：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
