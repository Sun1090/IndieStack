#!/usr/bin/env node
/**
 * Supabase security audit entrypoint.
 *
 * Node's native type stripping runs the shared ESM implementation; keeping this wrapper CJS
 * makes the package script work on Node 22 and Node 26 without a build step.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "supabase-security-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 Supabase 安全审计：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
