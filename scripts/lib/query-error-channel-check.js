/**
 * 查询错误通道门禁的 IO 层（v0.12.0 C08）。
 *
 * 规则本体是纯函数，住在 `src/lib/security/query-error-channel.ts` 并由 Vitest 覆盖；
 * 这里只负责读文件、跑规则、打印结果。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ERROR_CHANNEL_EXEMPTIONS,
  collectErrorChannelCasts,
  collectUnboundErrorChannels,
  inspectQueryErrorChannel,
  summarizeUnboundErrorChannels,
} from "../../src/lib/security/query-error-channel.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 参与扫描的目录：只有业务代码会这样读库；脚本与测试里的断言是刻意的假数据。 */
export const SCAN_DIRS = ["src"];

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name)
        ? [full]
        : [];
    })
    .sort();
}

/** 相对仓库根的 POSIX 路径，便于报告与 `file:line` 直接可点。 */
function toRepoPath(repoRoot, absolute) {
  return path.relative(repoRoot, absolute).split(path.sep).join("/");
}

export function buildSources(repoRoot = REPO_ROOT) {
  const files = SCAN_DIRS.flatMap((dir) => walk(path.join(repoRoot, dir)));
  const sources = files.map((file) => ({
    file: toRepoPath(repoRoot, file),
    content: fs.readFileSync(file, "utf8"),
  }));
  if (sources.length === 0)
    throw new Error(`no TypeScript sources found under ${SCAN_DIRS.join(", ")}`);
  return sources;
}

/** 返回进程退出码：0 表示错误通道没有被断言抹掉。 */
export function runQueryErrorChannelCheck(repoRoot = REPO_ROOT) {
  let sources;
  try {
    sources = buildSources(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取待扫描源码：${error.message}`);
    return 1;
  }

  const issues = inspectQueryErrorChannel(sources);
  const { judged, casts, unparseable } = collectErrorChannelCasts(sources);
  const ledger = Object.values(ERROR_CHANNEL_EXEMPTIONS).reduce(
    (total, entry) => total + entry.sites,
    0,
  );
  const coverage = `覆盖：${sources.length} 个文件 / ${judged} 处 awaited 查询结果断言，登记债务 ${casts.length}/${ledger} 处`;

  if (issues.length > 0) {
    console.error(`❌ 查询结果的 error 通道被断言抹掉（${issues.length} 项）`);
    for (const item of issues) console.error(`   ${item.code}: ${item.message}`);
    console.error(`   ${coverage}`);
    console.error(
      "   修法：绑定 `error` 并让它决定回答（读失败 ≠ 没有这一行）；确要保留则更新台账并写明理由。",
    );
    return 1;
  }

  console.log(
    `✅ 查询错误通道校验通过：${sources.length} 个文件 / ${judged} 处 awaited 查询结果断言，` +
      `无未登记的抹除（台账 ${ledger} 处，其中未解析文件 ${unparseable.length} 个）`,
  );
  return 0;
}

/**
 * C08-c 的**测量**模式（`--unbound`）：打印「解构 awaited 查询结果时压根不取 `error`」的分布。
 * 它不是门禁——判据还没经过误报测量，先把数量与清单摆出来（D01 口径）。
 * 退出码：0 = 量到了东西；1 = 读不到源码或一条都没判到（一份空洞的测量报告比没有更糟）。
 */
export function runUnboundErrorChannelReport(repoRoot = REPO_ROOT) {
  let sources;
  try {
    sources = buildSources(repoRoot);
  } catch (error) {
    console.error(`\u274c 无法读取待扫描源码：${error.message}`);
    return 1;
  }

  const summary = summarizeUnboundErrorChannels(collectUnboundErrorChannels(sources));
  if (summary.total === 0) {
    console.error(
      `\u274c 一处 awaited 查询结果的解构都没判到（${sources.length} 个文件）：测量本身失效了`,
    );
    return 1;
  }

  const line = (site) => `   ${site.file}:${site.line}  ${site.source}`;
  console.log(
    `C08-c 测量：${sources.length} 个文件 / ${summary.total} 处 awaited 查询结果的解构绑定`,
  );
  console.log(`\n\u2460 压根没绑 error（${summary.unbound.length} 处）：`);
  for (const site of summary.unbound) console.log(line(site));
  if (summary.skippedUnparseable > 0) {
    console.log(
      `\n\u26a0 ${summary.skippedUnparseable} 个文件因语法诊断被跳过，上面的数字对它们不适用`,
    );
  }
  console.log(
    "\n盲区（不在射程内，别把这份清单当全量）：`Promise.all` 里的查询链、非字面量表名的链、" +
      "被条件表达式包住的链（`cond ? await query : { … }`，所以这份清单是下界），" +
      "以及「绑了 `error` 却从不使用」那一档（需要作用域分析，没测）。",
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  const args = process.argv.slice(2);
  const repoRoot = args.find((arg) => !arg.startsWith("--")) ?? REPO_ROOT;
  process.exitCode = args.includes("--unbound")
    ? runUnboundErrorChannelReport(repoRoot)
    : runQueryErrorChannelCheck(repoRoot);
}
