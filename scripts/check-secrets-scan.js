#!/usr/bin/env node
/**
 * Secrets Scan 扫描强度与泄漏处置策略门禁入口（J05）。
 *
 * 校验逻辑与单测共用 src/lib/security/secrets-scan-policy.ts 与
 * scripts/lib/secrets-scan-policy-check.js，这里只负责用 Node 原生 type stripping 运行 ESM。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "secrets-scan-policy-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 Secrets Scan 策略校验：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
