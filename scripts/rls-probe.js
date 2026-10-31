#!/usr/bin/env node
/**
 * RLS 策略的**执行**取证（`check:rls-probe`）。
 *
 * 为什么需要它：`check:rls` 读的是迁移文本，能回答「策略写全了没有」，
 * 回答不了「这条策略真的按预期收口吗」。036 修的那条缺陷正好落在两者之间——
 * `team_members` **一行 UPDATE 策略都没有**，于是 PostgREST 的 UPDATE 命中 0 行、
 * `error` 为 null，`updateMemberRole()` 照样 `ok()`。静态扫描看不见它：
 * 在静态视角里「这张表有策略」和「这张表缺一条策略」长得几乎一样。
 *
 * 做法：起一个一次性 Postgres 集群 → 应用 `supabase/tests/bootstrap.sql`（Supabase 面替身）
 * → 按序应用全部真实迁移 → 逐个跑 `supabase/tests/*.sql` 探针 → 拆掉集群。
 * 探针用 `set role` + `request.jwt.claims` 扮演 PostgREST，用 `row_count` 判读
 * 「命中 0 行」与「with check 拒绝（-1）」，所以它验证的是数据库的真实行为。
 *
 * 可用性：本机没有 `initdb` / `pg_ctl` / `psql` 时**跳过而不是失败**（打印原因）。
 * 需要强制时设 `RLS_PROBE_REQUIRE=1`——CI 里应当设它，本机不必。
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const TESTS_DIR = path.join(ROOT, "supabase", "tests");
const BOOTSTRAP = path.join(TESTS_DIR, "bootstrap.sql");

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function findBin(name) {
  const found = run("sh", ["-c", `command -v ${name} || true`]).stdout.trim();
  return found || null;
}

/** 让内核给一个空闲端口，再关掉连接把它让出来（比固定端口少一类偶发冲突）。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function psql(args) {
  return run("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-q", ...args]);
}

function applyFile(socketDir, port, file) {
  const result = psql(["-h", socketDir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-f", file]);
  if (result.status !== 0) {
    const detail = `${result.stdout || ""}${result.stderr || ""}`.trim().split("\n").slice(-6).join("\n");
    return { ok: false, detail };
  }
  return { ok: true };
}

function listSql(dir, { exclude = [] } = {}) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql") && !exclude.includes(name))
    .sort()
    .map((name) => path.join(dir, name));
}

async function main() {
  const missing = ["initdb", "pg_ctl", "psql"].filter((bin) => !findBin(bin));
  if (missing.length > 0) {
    const message =
      `⚠️  check:rls-probe 跳过：缺少 ${missing.join(" / ")}（本机没有 Postgres 服务端工具）。\n` +
      `   RLS 策略这一层这次没有被执行验证，只有 check:rls 的静态扫描。`;
    if (process.env.RLS_PROBE_REQUIRE === "1") {
      console.error(message);
      console.error("   RLS_PROBE_REQUIRE=1，按失败处理。");
      process.exit(1);
    }
    console.log(message);
    return;
  }

  if (!fs.existsSync(BOOTSTRAP)) {
    console.error(`❌ 缺少 Supabase 面替身：${path.relative(ROOT, BOOTSTRAP)}`);
    process.exit(1);
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-rls-"));
  const socketDir = path.join(dataDir, "sock");
  const logFile = path.join(dataDir, "postgres.log");
  let started = false;

  const cleanup = () => {
    if (started) {
      run("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"], { stdio: "ignore" });
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    const init = run("initdb", ["-D", dataDir, "-U", "postgres", "--auth=trust", "-E", "UTF8"]);
    if (init.status !== 0) {
      console.error("❌ initdb 失败：\n" + `${init.stdout || ""}${init.stderr || ""}`.trim());
      process.exit(1);
    }
    fs.mkdirSync(socketDir, { recursive: true });

    const port = await freePort();
    const start = run("pg_ctl", [
      "-D",
      dataDir,
      "-l",
      logFile,
      "-w",
      "-o",
      `-p ${port} -k ${socketDir} -c listen_addresses='' -c fsync=off`,
      "start",
    ]);
    if (start.status !== 0) {
      const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
      console.error("❌ Postgres 启动失败：\n" + `${start.stdout || ""}${start.stderr || ""}${log}`.trim());
      process.exit(1);
    }
    started = true;

    const bootstrap = applyFile(socketDir, port, BOOTSTRAP);
    if (!bootstrap.ok) {
      console.error(`❌ bootstrap 应用失败：\n${bootstrap.detail}`);
      process.exit(1);
    }

    const migrations = listSql(MIGRATIONS_DIR);
    for (const file of migrations) {
      const applied = applyFile(socketDir, port, file);
      if (!applied.ok) {
        console.error(`❌ 迁移应用失败：${path.relative(ROOT, file)}\n${applied.detail}`);
        process.exit(1);
      }
    }

    const probes = listSql(TESTS_DIR, { exclude: ["bootstrap.sql"] });
    if (probes.length === 0) {
      console.error("❌ supabase/tests/ 下没有任何探针文件——这道门禁会永远是绿的，等于没做");
      process.exit(1);
    }

    let failures = 0;
    for (const probe of probes) {
      const result = psql([
        "-h",
        socketDir,
        "-p",
        String(port),
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-f",
        probe,
      ]);
      const name = path.relative(ROOT, probe);
      if (result.status === 0) {
        console.log(`✅ ${name}`);
        continue;
      }
      failures += 1;
      const detail = `${result.stdout || ""}${result.stderr || ""}`.trim().split("\n").slice(-14).join("\n");
      console.error(`❌ ${name}\n${detail}\n`);
    }

    if (failures > 0) {
      console.error(`❌ RLS 策略执行取证失败：${failures}/${probes.length} 个探针不通过`);
      process.exit(1);
    }

    console.log(
      `✅ RLS 策略执行取证通过：${migrations.length} 个迁移应用成功，${probes.length} 个探针在真库上跑通`,
    );
  } finally {
    cleanup();
  }
}

main().catch((error) => {
  console.error(`❌ check:rls-probe 异常：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
