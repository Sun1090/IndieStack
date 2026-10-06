/**
 * 保留期调度审计（CLI 主体）。
 *
 * 由 `scripts/check-retention-cron.js` 以 `node --experimental-strip-types` 起，
 * 判定逻辑在 `src/lib/db/retention-cron-audit.ts`（纯函数，有单测）。
 *
 * 用法：
 *   node scripts/check-retention-cron.js            # 只做静态审计（不需要数据库）
 *   node scripts/check-retention-cron.js --probe    # 额外问一次真库「pg_cron 装没装」
 *
 * 退出码：0 通过 / 1 发现问题 / 2 用法错误。
 *
 * **为什么静态审计与真实探测分成两步**：查 `pg_extension` 需要真 Postgres 连接，
 * 而本机没有 DB 密码（这正是 B04 的阻塞，见 `docs/operations/environments.md`）。
 * 把两者分开是为了让**静态审计永远可跑**——
 * 一个需要凭据才跑得起来的检查，迟早会因为没人有凭据而长期不跑。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditRetentionCron, extractJobs } from "../../src/lib/db/retention-cron-audit.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");


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

const PG_CRON_QUERY =
  "select case when exists(select 1 from pg_extension where extname='pg_cron') " +
  "then 'INSTALLED' else 'NOT_INSTALLED' end";

/**
 * 可选：问一次真库 pg_cron 装没装。
 *
 * **两条路径**：优先本机 `psql`；没有 `psql` 时退回 `docker exec`——因为本机的
 * Supabase 栈就是一个跑着的容器（`supabase_db_<project>`），而开发机上装 psql
 * 并不常见。没有 psql 也没有容器时要**明说连不上**，绝不能据此推断「没装」。
 */
function probePgCron(dbUrl, container) {
  if (!dbUrl && !container) return { probed: false, reason: "未提供 --db-url 或 --container" };
  const query = PG_CRON_QUERY;

  if (container) {
    try {
      const out = execFileSync(
        "docker",
        ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-tAc", query],
        { encoding: "utf8", timeout: 20000 },
      );
      return { probed: true, installed: out.trim() === "INSTALLED" };
    } catch (error) {
      return { probed: false, reason: `docker exec 失败：${String(error.message).split("\n")[0]}` };
    }
  }

  try {
    const out = execFileSync("psql", [dbUrl, "-tAc", query], { encoding: "utf8", timeout: 20000 });
    return { probed: true, installed: out.trim() === "INSTALLED" };
  } catch (error) {
    return { probed: false, reason: `连不上或没有 psql：${String(error.message).split("\n")[0]}` };
  }
}

/** 打印一次 pg_cron 探测的结果。抽出来是为了让 `main` 的复杂度回到限制内。 */
function reportProbe(args) {
  const dbUrlIndex = args.indexOf("--db-url");
  const dbUrl = dbUrlIndex === -1 ? process.env.SUPABASE_DB_URL : args[dbUrlIndex + 1];
  const containerIndex = args.indexOf("--container");
  const container = containerIndex === -1 ? undefined : args[containerIndex + 1];
  const probe = probePgCron(dbUrl, container);

  if (!probe.probed) {
    console.log(`\n⚠️ 未探测 pg_cron：${probe.reason}`);
    console.log("   这**不等于「pg_cron 已安装」**——要读真库需要 DB 密码（B04 的阻塞）。");
    return;
  }
  console.log(
    `\n${probe.installed ? "✅" : "❌"} pg_cron：${probe.installed ? "已安装" : "**未安装**"}` +
      (probe.installed ? "" : " → 所有保留期清理会被守卫静默跳过，一行都不会删"),
  );
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "用法：node scripts/check-retention-cron.js [--probe] [--db-url postgresql://…] [--container supabase_db_xxx]",
    );
    return 0;
  }
  // `--db-url` 的**值**是位置参数，不是未知参数——第一版没跳过它，
  // 于是 `--db-url <url>` 里的 url 被当成未知参数报错，而这条命令根本没有其他用法。
  const unknown = args.filter((a, i) => {
    if (a === "--probe") return false;
    if (a === "--db-url" || a === "--container") return false;
    // 紧跟在 --db-url 之后的那个 token 是它的值
    return args[i - 1] !== "--db-url" && args[i - 1] !== "--container";
  });
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

  if (args.includes("--probe")) reportProbe(args);

  if (report.ok) {
    console.log("\n✅ 保留期调度审计通过：全部 cron.schedule 都在 pg_cron 守卫内且写明了跳过语义");
    console.log("   注意：这**只说明代码把话说清楚了**，不代表 pg_cron 已安装。");
    return 0;
  }
  console.error(`\n❌ 保留期调度审计失败（${report.errors.length} 项）`);
  for (const error of report.errors) console.error(`  [${error.code}] ${error.message}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    process.exit(2);
  }
}
