#!/usr/bin/env node
/**
 * Provider diagnostics entry point (I08).
 *
 * The implementation lives in scripts/lib/provider-doctor.js and the shared
 * pure rules live in src/lib/providers/diagnostics.ts; this wrapper only enables
 * Node's native TypeScript type stripping for the ESM import chain.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "provider-doctor.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 provider 诊断：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
