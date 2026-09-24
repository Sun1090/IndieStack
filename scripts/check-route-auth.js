#!/usr/bin/env node
/**
 * 路由鉴权清单门禁入口（C11）。
 *
 * 规则与解析在 src/lib/security/route-auth.ts（纯函数、单测覆盖），IO 在
 * scripts/lib/route-auth-check.js，这里只负责用 Node 原生 type stripping 跑起 ESM
 * （`.ts` import 需要该 flag）——与 scripts/check-gates.js 同一形态。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "route-auth-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行路由鉴权清单门禁：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
