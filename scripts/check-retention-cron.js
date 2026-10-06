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
const REPO_ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

// 从 TS 源里复用纯逻辑：这里用 tsx/编译产物不合适，所以直接 require 已编译的 dist 不存在，
// 因此走 `node --experimental-strip-types` 的等价物——即用 tsx 运行本脚本。
// 项目已装 tsx（devDependency），但 check:* 脚本要在 CI 里用纯 node 跑，
// 所以这里不引 tsx：改为在 CI 用 `node --experimental-strip-types`。
const { auditRetentionCron, extractJobs } = require("./lib/retention-cron-audit.cjs");

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`找不到迁移目录：${MIGRATIONS_DIR}`);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** 静态审计：读全部迁移，抽出调度并判定。 */
function auditMigrations() {
  const jobs = [];
  for (const name of listMigrations()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
    jobs.push(...extractJobs(name, sql));
  }
  return auditRetentionCron(jobs);
}

/** 可选：问一次真库 pg_cron 装没装。失败要说清是「没连上」而不是「没装」。 */
function probePgCron(dbUrl) {
  if (!dbUrl) return { probed: false, reason: "未提供 --db-url" };
  try {
    const out = execFileSync(
      "psql",
      [dbUrl, "-tAc", "select case when exists(select 1 from pg_extension where extname='pg_cron') then 'INSTALLED' else 'NOT_INSTALLED' end"],
      { encoding: "utf8", timeout: 20000 },
    );
    return { probed: true, installed: out.trim() === "INSTALLED" };
  } catch (error) {
    return { probed: false, reason: `连不上或没有 psql：${error.message.split("\n")[0]}` };
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "用法：node scripts/check-retention-cron.js [--probe] [--db-url postgresql://…]",
    );
    return 0;
  }
  const unknown = args.filter((a) => a !== "--probe" && !a.startsWith("--db-url"));
  if (unknown.length > 0) {
    console.error(`❌ 未知参数：${unknown.join(", ")}`);
    return 2;
  }

  const report = auditMigrations();
  console.log(`扫描迁移：${listMigrations().length} 份，抽出 cron.schedule ${report.jobs.length} 处`);
  for (const job of report.jobs) {
    console.log(
      `  - ${job.file} · ${job.name}：${job.guarded ? "已守卫" : "❌ 未守卫"}${
        job.documented ? "（已写明跳过）" : "（未写明跳过）"
      }`,
    );
  }

  if (args.includes("--probe")) {
    const dbUrlIndex = args.indexOf("--db-url");
    const dbUrl = dbUrlIndex === -1 ? process.env.SUPABASE_DB_URL : args[dbUrlIndex + 1];
    const probe = probePgCron(dbUrl);
    if (!probe.probed) {
      console.log(`\n⚠️ 未探测 pg_cron：${probe.reason}`);
      console.log("   这**不等于「pg_cron 已安装」**——要读真库需要 DB 密码（B04 的阻塞）。");
    } else {
      console.log(
        `\n${probe.installed ? "✅" : "❌"} pg_cron：${probe.installed ? "已安装" : "**未安装**"}` +
          (probe.installed ? "" : " → 所有保留期清理会被守卫静默跳过，一行都不会删"),
      );
    }
  }

  if (report.ok) {
    console.log("\n✅ 保留期调度审计通过：全部 cron.schedule 都在 pg_cron 守卫内且写明了跳过语义");
    console.log("   注意：这**只说明代码把话说清楚了**，不代表 pg_cron 已安装。");
    return 0;
  }
  console.error(`\n❌ 保留期调度审计失败（${report.errors.length} 项）`);
  for (const error of report.errors) console.error(`  [${error.code}] ${error.message}`);
  return 1;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(2);
  }
}

module.exports = { auditMigrations, listMigrations, main, probePgCron };