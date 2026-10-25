import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
/**
 * `pnpm drills:preflight` 的 IO 层：读环境 → 调纯规则 → 打印 → 给退出码。
 *
 * **退出码的语义是刻意分开的**：
 *  - `0`：所有被问到的演练前置齐了，**可以跑**；
 *  - `1`：有前置缺失（这是本命令在今天的常态，因为三条演练都缺外部权限）；
 *  - `2`：用法错误（比如 `--drill B09`）。
 *
 * 刻意**没有**「演练通过」这个退出码：前置判定与实跑结论是两件事，
 * 把它们挤进同一个退出码就等于给这个命令一个它没有的权威。
 */
// 类型走 JSDoc 而不是 `import type`：本文件是 .js，node 的类型剥离只作用于 .ts，
// 在 .js 里写类型导入会直接语法报错（第一版就踩了）。
import {
  credentialLooksConfigured,
  evaluateAllDrills,
  fileRequirementPaths,
  summarize,
} from "../../src/lib/drills/preflight.ts";
import { readEnvSources } from "./env-sources.js";

/** 仓库根：`file:` 型前置里不带 `~` 的路径一律相对它解析。 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @typedef {import("../../src/lib/drills/preflight.ts").DrillId} DrillId */
/** @typedef {import("../../src/lib/drills/preflight.ts").EnvProbe} EnvProbe */

/** @type {DrillId[]} */
const VALID_IDS = ["B03", "B04", "B05"];

/** @param {string[]} argv */
function parseOnly(argv) {
  const index = argv.indexOf("--drill");
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || !VALID_IDS.includes(value)) {
    console.error(`❌ --drill 需要一个真实编号：${VALID_IDS.join(" / ")}（收到 ${value ?? "空"}）`);
    process.exit(2);
  }
  return /** @type {DrillId} */ (value);
}

/**
 * 把环境读成「这个来源有没有」的表。
 *
 * `file:` 前缀的来源读**文件内容**而不是只看存在性——空文件与不存在等价，
 * 这是 `.supabase/access-token` 被 `echo >` 清空时的真实形态。
 */
function readEnvProbe() {
  /** @type {EnvProbe} */
  const probe = {};
  const resolved = readEnvSources(REPO_ROOT);
  const names = new Set();
  for (const spec of evaluateAllDrills({}).flatMap((verdict) => verdict.requirements)) {
    for (const part of spec.source.split(" + ")) names.add(part.trim());
  }
  for (const name of names) {
    if (name.startsWith("file:")) {
      // 候选路径由纯函数给出：仓库相对的前置必须**与 cwd 无关**地成立，
      // 否则从仓库外面跑一次就会把已满足的报成未满足（详见那个函数的注释）。
      const candidates = fileRequirementPaths(name, process.env.HOME ?? "~", REPO_ROOT);
      probe[name] = candidates.some((file) => {
        try {
          return fs.existsSync(file) && fs.readFileSync(file, "utf8").trim().length > 0;
        } catch {
          return false;
        }
      });
      continue;
    }
    probe[name] = credentialLooksConfigured(resolved[name]);
  }
  return probe;
}

/**
 * env 取数口外移到 `scripts/lib/env-sources.js`（2026-10-25）：
 * 同一个「只看 process.env」的缺陷不止住在本命令——`ops:migration-status`、
 * `ops:digest-observation`、`db:apply`、`ops:cloud-sql-probe` 全都一样，
 * 而 `node scripts/*` 不加载 `.env.local`（Next 运行时才加载）。
 * 逐个脚本打补丁必然漏，所以共享一个取数口；名单顺序（具体 → 笼统）
 * 由 `src/lib/env-credentials.test.ts` 钉住。
 */

function runDrillPreflight() {
  const only = parseOnly(process.argv.slice(2));
  const probe = readEnvProbe();
  const verdicts = evaluateAllDrills(probe, only);
  const summary = summarize(verdicts);

  for (const verdict of verdicts) {
    const mark = verdict.ready ? "✅" : "⛔";
    console.log(`${mark} ${verdict.id} ${verdict.title}`);
    if (!verdict.ready) console.log(`   阻塞原因：${verdict.blockedReason}`);
    for (const requirement of verdict.requirements) {
      console.log(
        `   ${requirement.satisfied ? "✓" : "·"} ${requirement.source}${
          requirement.satisfied ? "" : `  ← 缺。${requirement.remedy}`
        }`,
      );
      if (!requirement.satisfied) console.log(`     用途：${requirement.purpose}`);
    }
    console.log(`   齐了之后第一步：${verdict.firstCommand}`);
    console.log(`   结论落点：${verdict.evidenceTarget}`);
    console.log("");
  }

  console.log(summary.headline);
  console.log("");
  console.log("提醒：本命令只判定前置，不执行任何演练，也不代表任何演练已通过。");
  return summary.ready.length === verdicts.length ? 0 : 1;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runDrillPreflight();