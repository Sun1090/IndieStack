/**
 * `check:rls-probe` 的 IO 层：起一次性 Postgres → 应用替身与全部迁移 → 跑探针 → 拆集群。
 *
 * 判定全在 `src/lib/db/rls-probe.ts`。这里只回答「怎么把事做出来」，不回答「什么算通过」——
 * 唯一的例外是「怎么把一个进程退出码读成 ok/不 ok」，那是 IO 的语义。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_BINARIES,
  auditProbeInventory,
  decidePrerequisite,
  formatProbeIssues,
  summarizeProbeRun,
} from "../../src/lib/db/rls-probe.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const TESTS_DIR = path.join(REPO_ROOT, "supabase", "tests");
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

/**
 * 起一个一次性集群。成功返回 `{ ok: true }`，失败返回 `{ ok: false, detail }`。
 *
 * `-c fsync=off` 与 `listen_addresses=''` 是刻意的：这个库只活几十秒，只走 unix socket，
 * 既要快也不要对外开端口（免掉一类「本机某进程连上了测试库」的意外）。
 */
function startCluster(dataDir, socketDir, logFile, port) {
  const init = run("initdb", ["-D", dataDir, "-U", "postgres", "--auth=trust", "-E", "UTF8"]);
  if (init.status !== 0) {
    return { ok: false, detail: `${init.stdout || ""}${init.stderr || ""}`.trim() };
  }
  fs.mkdirSync(socketDir, { recursive: true });

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
  if (start.status === 0) return { ok: true, detail: "" };
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  return { ok: false, detail: `${start.stdout || ""}${start.stderr || ""}${log}`.trim() };
}

/** 按文件名顺序应用全部迁移；返回第一个失败的文件与细节（成功时 `file` 为 null）。 */
function applyMigrations(socketDir, port) {
  const migrations = listSql(MIGRATIONS_DIR);
  for (const file of migrations) {
    const applied = applyFile(socketDir, port, file);
    if (!applied.ok) return { ok: false, applied: migrations.length, file, detail: applied.detail };
  }
  return { ok: true, applied: migrations.length, file: null, detail: "" };
}

/** 逐个跑探针；`failures` 是 psql 退出码非 0 的个数。 */
function runProbes(socketDir, port) {
  const probes = listSql(TESTS_DIR, { exclude: ["bootstrap.sql"] });
  let failures = 0;
  for (const probe of probes) {
    const result = psql(["-h", socketDir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-f", probe]);
    const name = path.relative(REPO_ROOT, probe);
    if (result.status === 0) {
      console.log(`✅ ${name}`);
      continue;
    }
    failures += 1;
    const detail = `${result.stdout || ""}${result.stderr || ""}`.trim().split("\n").slice(-14).join("\n");
    console.error(`❌ ${name}\n${detail}\n`);
  }
  return failures;
}

async function main() {
  const missingBins = REQUIRED_BINARIES.filter((bin) => !findBin(bin));
  const decision = decidePrerequisite({ missingBins, requireFlag: process.env.RLS_PROBE_REQUIRE });
  if (decision.action === "fail") {
    console.error(`❌ ${decision.message}`);
    return 1;
  }
  if (decision.action === "skip") {
    console.log(`⚠️  ${decision.message}`);
    return 0;
  }

  if (!fs.existsSync(BOOTSTRAP)) {
    console.error(`❌ 缺少 Supabase 面替身：${path.relative(REPO_ROOT, BOOTSTRAP)}`);
    return 1;
  }

  // 盘点在起集群之前做：一个注定要红的探针集合不该先花 20 秒建库。
  const inventory = auditProbeInventory(
    fs
      .readdirSync(TESTS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => ({ name, text: fs.readFileSync(path.join(TESTS_DIR, name), "utf8") })),
  );
  if (inventory.issues.length > 0) {
    console.error(`❌ 探针盘点不通过（${inventory.issues.length} 项）`);
    console.error(formatProbeIssues(inventory.issues));
    return 1;
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
    const port = await freePort();
    const cluster = startCluster(dataDir, socketDir, logFile, port);
    if (!cluster.ok) {
      console.error(`❌ 起库失败（initdb 或 pg_ctl start）：\n${cluster.detail}`);
      return 1;
    }
    started = true;

    const bootstrap = applyFile(socketDir, port, BOOTSTRAP);
    if (!bootstrap.ok) {
      console.error(`❌ bootstrap 应用失败：\n${bootstrap.detail}`);
      return 1;
    }

    const migrations = applyMigrations(socketDir, port);
    if (!migrations.ok) {
      console.error(`❌ 迁移应用失败：${path.relative(REPO_ROOT, migrations.file)}\n${migrations.detail}`);
      return 1;
    }

    const summary = summarizeProbeRun({
      migrations: migrations.applied,
      probeFiles: inventory.stats.probeFiles,
      cases: inventory.stats.cases,
      failures: runProbes(socketDir, port),
    });
    if (!summary.ok) {
      console.error(`❌ ${summary.message}`);
      return 1;
    }
    console.log(`✅ ${summary.message}`);
    return 0;
  } finally {
    cleanup();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`❌ check:rls-probe 异常：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
