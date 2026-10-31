#!/usr/bin/env node
/**
 * RLS 策略执行取证入口（`check:rls-probe`）。
 *
 * 判定在 `src/lib/db/rls-probe.ts`（纯函数，有单测），IO 在 `scripts/lib/rls-probe-check.js`。
 * 这个 wrapper 只做一件事：用 Node 原生 type stripping 起 IO 层——
 * 拆分前判定内联在本文件里，被 `check:gate-rule-tests` 判红（`INLINE_GATE_REINTRODUCED`），
 * 理由正当：判定内联在脚本里，门禁的「会不会响」就没有单测兜底。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "rls-probe-check.js");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`❌ 无法运行 RLS 策略执行取证：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
