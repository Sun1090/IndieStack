#!/usr/bin/env node
/** Local Supabase migration-history drift gate entrypoint. */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "migration-history-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行迁移历史校验：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
