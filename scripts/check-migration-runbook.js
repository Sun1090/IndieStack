#!/usr/bin/env node
/**
 * 迁移回滚 runbook 门禁入口（I10）。
 *
 * 校验逻辑与单测共用 src/lib/db/migration-runbook.ts 与 scripts/lib/migration-runbook-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（.ts import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "migration-runbook-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行迁移回滚 runbook 检查：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
