#!/usr/bin/env node
/**
 * Security/config gate entrypoint.
 *
 * Node's native type stripping runs the shared ESM implementation; keeping this wrapper CJS
 * makes the package script work on Node 22 and Node 26 without a build step.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "security-config-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 security/config 校验：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
