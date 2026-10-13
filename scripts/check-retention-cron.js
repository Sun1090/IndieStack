#!/usr/bin/env node
/**
 * 保留期调度审计（薄壳）。
 *
 * 判定逻辑写在 `scripts/lib/retention-cron-check.ts`（TypeScript），
 * 这里只负责用 `node --experimental-strip-types` 起它——
 * 与 `scripts/check-changelog-tags.js` 同一套做法（CI 里跑的就是纯 node）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "lib", "retention-cron-check.ts");
const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`\u274c \u65e0\u6cd5\u8fd0\u884c\u4fdd\u7559\u671f\u8c03\u5ea6\u5ba1\u8ba1\uff1a${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

/**
 * ## 这里曾有 93 行永不执行的实现，已删除（2026-10-14）
 *
 * 上面那句 `process.exit()` 是**无条件**的，所以它下面的整段旧实现（`main()`、
 * `auditMigrations()`、`probePgCron()` 与入口调用）永远到不了。
 * 判定与输出真正的家在同目录的 `lib/retention-cron-check.ts`。
 *
 * **它从未执行过的证据不需要靠读控制流推断**：那段代码 `require` 的
 * `./lib/retention-cron-audit.cjs` **在仓库里不存在**，而它用的 `fs` 与 `execFileSync`
 * 也没有 import——真跑一次就是 `Cannot find module` + `fs is not defined`。
 * 也就是说它不但死，而且**坏**；坏而无人知，正是因为没人能跑到它。
 *
 * 为什么没有任何工具抓到它：`no-unreachable` **不认为 `process.exit()` 会终止语句序列**。
 * 实测（2026-10-14，`--no-config-lookup --rule '{"no-unreachable":"error"}'`）：
 * `process.exit(1); const a = 1; console.log(a);` 与
 * `process.exit(1); function main(){…} if (require.main === module) { main(); }`
 * 两种形状都**零告警**。⇒ 这条教训不是「lint 配漏了」，而是**lint 在这件事上没有判断力**：
 * 唯一能发现「这段代码永远不会跑」的手段是**它坏掉的时候有人去跑它**——
 * 而没人会跑一个已经 `exit` 的脚本。⇒ **迁移脚本时，删旧比加新更容易被漏掉。**
 */

module.exports = { auditMigrations, listMigrations, main, probePgCron };
