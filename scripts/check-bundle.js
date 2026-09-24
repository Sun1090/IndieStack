#!/usr/bin/env node
/**
 * Bundle 体积门禁入口。
 *
 * 判定规则在 src/lib/release/bundle-freshness.ts，IO/CLI 在
 * scripts/lib/bundle-freshness-check.js，这里只负责用 Node 原生 type stripping
 * 运行 ESM（.ts import 需要该 flag）——与 scripts/check-gates.js 同一形态。
 *
 * 本脚本自己不构建：`.next/static` 必须由调用方先产出（`pnpm build` /
 * `pnpm verify:build` / CI 的 Build job），否则新鲜度判定会直接失败退出。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "bundle-freshness-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 bundle 体积门禁：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
