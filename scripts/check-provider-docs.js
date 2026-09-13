#!/usr/bin/env node
/**
 * Provider documentation parity gate entry point (I08).
 *
 * Mirrors the mock-docs and ADR gates: the wrapper enables Node's native
 * TypeScript type stripping, while the pure rules stay unit-tested in src/.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "provider-docs-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 provider 文档一致性检查：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
