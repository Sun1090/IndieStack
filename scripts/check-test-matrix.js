#!/usr/bin/env node
/**
 * 贡献者测试矩阵门禁入口（I09）。
 *
 * 校验逻辑与单测共用 src/lib/testing/test-matrix.ts 与 scripts/lib/test-matrix-check.js，
 * 这里只负责用 Node 原生 type stripping 运行 ESM（.ts import 需要该 flag）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "test-matrix-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行贡献者测试矩阵检查：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
